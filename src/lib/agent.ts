import { chatComplete, chatStream, type ChatMessage, type ToolCall, type ToolDef } from "./ai";
import { parseCitationsBlock, verifyQuotes, type PageSpan } from "./quotes";
import { searchChunks, type SearchHit } from "./search";
import type { ChunkRow, DocRow, PageRow } from "./store";
import type { AgentActivity } from "@/lib/types";

export type LoadedDoc = {
  document: DocRow & { extractedText: string };
  chunks: ChunkRow[];
  pages: PageRow[];
};

const MAX_ROUNDS = 6;
const TOOL_CHAR_CAP = 2500;

const TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "search_document",
      description:
        "Search one or all loaded documents for passages matching a query. Use this before answering. Covers the whole document, not just the opening pages.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Keywords or a short phrase to find." },
          document_id: {
            type: "string",
            description: "Optional document id. Omit to search every loaded document.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_section",
      description: "Return a named section or heading and the text that follows it.",
      parameters: {
        type: "object",
        properties: {
          heading: { type: "string" },
          document_id: { type: "string" },
        },
        required: ["heading"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_clauses",
      description: "List standard clause types detected in the document(s), with short excerpts.",
      parameters: {
        type: "object",
        properties: {
          document_id: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_pages",
      description: "Return verbatim text for an inclusive page range. Cap of 8 pages per call.",
      parameters: {
        type: "object",
        properties: {
          document_id: { type: "string" },
          start: { type: "integer" },
          end: { type: "integer" },
        },
        required: ["document_id", "start", "end"],
      },
    },
  },
];

function clip(text: string, cap = TOOL_CHAR_CAP) {
  if (text.length <= cap) return text;
  return `${text.slice(0, cap)}\n\n[truncated]`;
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || "{}");
    if (v && typeof v === "object") return v as Record<string, unknown>;
    return {};
  } catch {
    return { __parseError: true };
  }
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function asInt(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return Number(v.trim());
  return undefined;
}

function formatHits(hits: SearchHit[]) {
  if (!hits.length) return "No matching passages.";
  return hits
    .map(
      (h, i) =>
        `[${i + 1}] ${h.documentName} (id ${h.documentId}) p.${h.pageStart}${h.pageEnd !== h.pageStart ? "–" + h.pageEnd : ""}${h.heading ? ` · ${h.heading}` : ""}\n${h.text}`,
    )
    .join("\n\n");
}

// Semantic re-rank: embed the query once, cosine-match chunks that carry
// cached vectors, and fuse 50/50 with lexical order. Chunks without vectors
// (old documents, failed embedding) keep their lexical rank. Never throws.
async function fuseSemantic(
  query: string,
  scope: LoadedDoc[],
  lexical: SearchHit[],
): Promise<SearchHit[]> {
  try {
    const withVec = scope.flatMap((d) => d.chunks.filter((c) => c.embedding?.length));
    if (!withVec.length) return lexical.slice(0, 5);
    const { embedBatch, cosine } = await import("./embed");
    const qv = await embedBatch([query]);
    if (!qv?.[0]) return lexical.slice(0, 5);
    const q = qv[0]!;
    const lexRank = new Map<string, number>();
    lexical.forEach((h, i) => lexRank.set(`${h.documentId}:${h.text.slice(0, 60)}`, i));
    const scored = withVec.map((c) => {
      const sem = cosine(q, c.embedding!);
      const key = `${c.documentId}:${c.text.slice(0, 60)}`;
      const lr = lexRank.has(key) ? 1 - lexRank.get(key)! / Math.max(1, lexical.length) : 0;
      return { c, score: 0.5 * sem + 0.5 * lr };
    });
    scored.sort((a, b) => b.score - a.score);
    const byChunk = new Map<string, SearchHit>();
    for (const h of lexical) byChunk.set(`${h.documentId}:${h.text.slice(0, 60)}`, h);
    const out: SearchHit[] = [];
    for (const s of scored.slice(0, 5)) {
      const key = `${s.c.documentId}:${s.c.text.slice(0, 60)}`;
      const known = byChunk.get(key);
      if (known) {
        out.push(known);
        continue;
      }
      const owner = scope.find((d) => d.document.id === s.c.documentId)!;
      out.push({
        documentId: s.c.documentId,
        documentName: owner.document.name,
        chunkIndex: s.c.chunkIndex,
        heading: s.c.heading,
        text: s.c.text,
        pageStart: s.c.pageStart,
        pageEnd: s.c.pageEnd,
        score: s.score,
      });
    }
    return out.length ? out : lexical.slice(0, 5);
  } catch {
    return lexical.slice(0, 5);
  }
}

async function runTool(
  call: ToolCall,
  docs: LoadedDoc[],
): Promise<{ result: string; activity: AgentActivity; coverageAll: boolean }> {
  const name = call.function?.name || "";
  const args = parseArgs(call.function?.arguments || "");
  if (args.__parseError) {
    return {
      result: JSON.stringify({ error: "Malformed tool arguments. Pass a JSON object." }),
      activity: { kind: "note", label: "Ignored a malformed tool call" },
      coverageAll: false,
    };
  }

  const byId = new Map(docs.map((d) => [d.document.id, d]));
  const pickDocs = (id?: string) => {
    if (!id) return docs;
    const hit = byId.get(id);
    return hit ? [hit] : [];
  };

  if (name === "search_document") {
    const query = asString(args.query);
    if (!query) {
      return {
        result: JSON.stringify({ error: "query must be a non-empty string" }),
        activity: { kind: "note", label: "search_document missing query" },
        coverageAll: false,
      };
    }
    const docId = asString(args.document_id);
    const scope = pickDocs(docId);
    if (!scope.length) {
      return {
        result: JSON.stringify({ error: `Unknown document_id: ${docId}` }),
        activity: { kind: "note", label: "search_document with unknown document" },
        coverageAll: false,
      };
    }
    const hits = searchChunks(
      query,
      scope.map((d) => ({ document: d.document, chunks: d.chunks })),
      10,
    );
    const fused = await fuseSemantic(query, scope, hits);
    return {
      result: clip(formatHits(fused)),
      activity: {
        kind: "search",
        label: `Searching for “${query.slice(0, 80)}”`,
        detail: docId ? scope[0]!.document.name : `${scope.length} documents`,
      },
      coverageAll: true,
    };
  }

  if (name === "list_clauses") {
    const docId = asString(args.document_id);
    const scope = pickDocs(docId);
    if (!scope.length) {
      return {
        result: JSON.stringify({ error: `Unknown document_id: ${docId}` }),
        activity: { kind: "note", label: "list_clauses with unknown document" },
        coverageAll: false,
      };
    }
    const lines = scope.flatMap((d) => {
      const clauses = d.document.clausesJson || [];
      if (!clauses.length) return [`${d.document.name}: no standard clauses detected.`];
      return [
        `${d.document.name} (id ${d.document.id})`,
        ...clauses.map((c) => `- ${c.label} (p.${c.page}): ${c.excerpt}`),
      ];
    });
    return {
      result: clip(lines.join("\n")),
      activity: { kind: "clauses", label: "Listing standard clauses" },
      coverageAll: true,
    };
  }

  if (name === "get_section") {
    const heading = asString(args.heading);
    if (!heading) {
      return {
        result: JSON.stringify({ error: "heading is required" }),
        activity: { kind: "note", label: "get_section missing heading" },
        coverageAll: false,
      };
    }
    const docId = asString(args.document_id);
    const scope = pickDocs(docId);
    const needle = heading.toLowerCase();
    const parts: string[] = [];
    for (const d of scope) {
      const outline = d.document.outlineJson || [];
      const entry = outline.find((o) => o.heading.toLowerCase().includes(needle));
      if (entry) {
        const slice = d.document.extractedText.slice(entry.charStart, Math.min(d.document.extractedText.length, entry.charStart + 3500));
        parts.push(`${d.document.name} · ${entry.heading} (p.${entry.page})\n${slice}`);
        continue;
      }
      const chunk = d.chunks.find((c) => (c.heading || "").toLowerCase().includes(needle) || c.text.toLowerCase().includes(needle));
      if (chunk) {
        parts.push(`${d.document.name} · ${chunk.heading || "Passage"} (p.${chunk.pageStart})\n${chunk.text}`);
      }
    }
    return {
      result: clip(parts.join("\n\n") || "No section matched that heading."),
      activity: { kind: "section", label: `Opening “${heading.slice(0, 80)}”` },
      coverageAll: false,
    };
  }

  if (name === "get_pages") {
    const docId = asString(args.document_id);
    const start = asInt(args.start);
    const end = asInt(args.end);
    if (!docId || start == null || end == null) {
      return {
        result: JSON.stringify({ error: "document_id, start and end are required" }),
        activity: { kind: "note", label: "get_pages missing arguments" },
        coverageAll: false,
      };
    }
    const doc = byId.get(docId);
    if (!doc) {
      return {
        result: JSON.stringify({ error: `Unknown document_id: ${docId}` }),
        activity: { kind: "note", label: "get_pages with unknown document" },
        coverageAll: false,
      };
    }
    const from = Math.max(1, Math.min(start, end));
    const to = Math.min(doc.document.pageCount || end, Math.max(start, end), from + 7);
    const text = doc.pages
      .filter((p) => p.pageNumber >= from && p.pageNumber <= to)
      .map((p) => `--- ${doc.document.name} p.${p.pageNumber} ---\n${p.text}`)
      .join("\n\n");
    return {
      result: clip(text || "No text in that page range."),
      activity: {
        kind: "pages",
        label: `Reading pages ${from}–${to} of ${doc.document.name}`,
      },
      coverageAll: from <= 1 && to >= (doc.document.pageCount || 0),
    };
  }

  return {
    result: JSON.stringify({
      error: `Unknown tool “${name}”. Available: search_document, get_section, list_clauses, get_pages.`,
    }),
    activity: { kind: "note", label: `Unknown tool “${name}”` },
    coverageAll: false,
  };
}

function systemPrompt(docs: LoadedDoc[], multi: boolean) {
  const roster = docs
    .map((d) => {
      const outline = (d.document.outlineJson || [])
        .slice(0, 12)
        .map((o) => `    - ${o.heading} (p.${o.page})`)
        .join("\n");
      return `- ${d.document.name} [id: ${d.document.id}] · ${d.document.pageCount} pages · ${d.document.charCount} chars\n${outline}`;
    })
    .join("\n");

  return `You are Vellum, a contract analyst. You may only use facts found via tools.
The documents are too large to fit in a prompt. Never pretend you read pages you did not retrieve.
If you did not search the whole document, you must not claim a clause is absent.

Rules:
- Call tools until you have enough verbatim text to answer.
- Copy quotations exactly as they appear in tool output. Do not paraphrase inside quotes. Prefer 15+ words.
- If the answer is not in the documents, say so plainly. Do not invent a clause.
- ${multi ? "Write one comparative answer across the documents, not a separate memo per file. Each quote must name its document id." : "Stay inside the single loaded document."}
- After the answer, output a citations block in this exact form:

CITATIONS:
- quote: "exact wording from the document"
  document: <document id>

Documents:
${roster}`;
}

export type AgentResult = {
  answer: string;
  activity: AgentActivity[];
  coverage: "full" | "partial";
  coverageNote: string | null;
  quotes: Array<{
    documentId: string;
    quoteText: string;
    verified: boolean;
    omitted: boolean;
    displayText: string | null;
    pageNumber: number | null;
    pageEnd: number | null;
    charStart: number | null;
    charEnd: number | null;
    occurrence: number;
    totalOccurrences: number;
  }>;
  droppedUnverified: number;
};

export async function runAgent(opts: {
  docs: LoadedDoc[];
  question: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  signal?: AbortSignal;
  // Hard wall-clock budget (ms). Big files + throttled providers must end in
  // a graceful partial answer, never a severed stream. Defaults to 100s so
  // serverless timeouts (often 60–120s) don't cut the response mid-write.
  deadlineMs?: number;
  onStatus: (activity: AgentActivity) => Promise<void> | void;
  onToken: (token: string) => Promise<void> | void;
}): Promise<AgentResult> {
  const startedAt = Date.now();
  const deadlineMs = opts.deadlineMs ?? 100_000;
  const outOfTime = () => Date.now() - startedAt > deadlineMs;
  const multi = opts.docs.length > 1;
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(opts.docs, multi) },
    ...opts.history.slice(-8).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: opts.question },
  ];

  const activity: AgentActivity[] = [];
  let searchedAll = false;
  let rounds = 0;
  let final = "";

  while (rounds < MAX_ROUNDS) {
    if (opts.signal?.aborted || outOfTime()) break;
    rounds += 1;
    const { content, toolCalls } = await chatComplete({
      messages,
      tools: TOOLS,
      signal: opts.signal,
    });

    if (toolCalls.length) {
      messages.push({
        role: "assistant",
        content: content || null,
        tool_calls: toolCalls,
      });
      for (const call of toolCalls) {
        const executed = await runTool(call, opts.docs);
        activity.push(executed.activity);
        await opts.onStatus(executed.activity);
        if (executed.coverageAll) searchedAll = true;
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: executed.result,
        });
      }
      continue;
    }

    if (content) {
      final = content;
    }
    break;
  }

  if (!final && !opts.signal?.aborted) {
    if (!outOfTime()) {
      await opts.onStatus({ kind: "note", label: "Writing the answer from retrieved passages" });
    }
    messages.push({
      role: "user",
      content:
        "Stop calling tools. Answer from the passages you already retrieved. If something is missing, say so. Then output the CITATIONS block.",
    });
    final = await chatStream({
      messages,
      signal: opts.signal,
      onToken: opts.onToken,
    });
  } else if (final) {
    // Stream the already-complete answer in chunks so the UI still types it out.
    const parts = final.split(/(\s+)/);
    let acc = "";
    for (const part of parts) {
      if (opts.signal?.aborted) break;
      acc += part;
      await opts.onToken(part);
    }
    final = acc || final;
  }

  const fallbackId = opts.docs[0]!.document.id;
  const knownIds = opts.docs.map((d) => d.document.id);
  const parsed = parseCitationsBlock(final, fallbackId, knownIds);
  const nameToId = new Map<string, string>();
  for (const d of opts.docs) {
    nameToId.set(d.document.name.toLowerCase(), d.document.id);
    nameToId.set(d.document.originalFilename.toLowerCase(), d.document.id);
    nameToId.set(d.document.id.toLowerCase(), d.document.id);
  }
  const remapped = parsed.quotes.map((q) => {
    const lower = q.documentId.toLowerCase();
    const mapped = nameToId.get(lower);
    if (mapped) return { ...q, documentId: mapped };
    const byName = opts.docs.find(
      (d) =>
        lower.includes(d.document.name.toLowerCase()) ||
        d.document.name.toLowerCase().includes(lower),
    );
    return { ...q, documentId: byName?.document.id || fallbackId };
  });

  const verifiedPack = verifyQuotes(
    parsed.answer ? remapped : remapped,
    opts.docs.map((d) => ({
      id: d.document.id,
      extractedText: d.document.extractedText,
      pages: d.pages.map(
        (p): PageSpan => ({
          pageNumber: p.pageNumber,
          charStart: p.charStart,
          charEnd: p.charEnd,
        }),
      ),
    })),
  );

  const quotes: AgentResult["quotes"] = [
    ...verifiedPack.verified.map((v) => ({
      documentId: v.documentId,
      quoteText: v.quoteText,
      verified: true,
      omitted: false,
      displayText: v.match.matchedText.replace(/\s+/g, " ").trim(),
      pageNumber: v.match.pageNumber,
      pageEnd: v.match.pageEnd,
      charStart: v.match.start,
      charEnd: v.match.end,
      occurrence: v.match.occurrence,
      totalOccurrences: v.match.total,
    })),
    ...verifiedPack.unverified.map((u) => ({
      documentId: u.documentId,
      quoteText: u.quoteText,
      verified: false,
      omitted: true,
      displayText: null,
      pageNumber: null,
      pageEnd: null,
      charStart: null,
      charEnd: null,
      occurrence: 0,
      totalOccurrences: 0,
    })),
  ];

  const timedOut = outOfTime();
  const coverage: "full" | "partial" = searchedAll || opts.docs.every((d) => d.document.charCount < 12000) ? "full" : "partial";
  const coverageNote =
    timedOut && coverage === "full"
      ? "Time ran short before every corner of the file could be checked. Treat absence of a clause as unconfirmed."
      : coverage === "partial"
        ? "Only some of the document was retrieved before answering. Absence of a clause is not certain."
        : null;

  return {
    answer: parsed.answer,
    activity,
    coverage: timedOut ? "partial" : coverage,
    coverageNote,
    quotes,
    droppedUnverified: verifiedPack.unverified.length,
  };
}
