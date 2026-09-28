export type QuoteMatch = {
  start: number;
  end: number;
  pageNumber: number;
  pageEnd: number;
  excerpt: string;
  occurrence: number;
  total: number;
  matchedText: string;
};

export type PageSpan = {
  pageNumber: number;
  charStart: number;
  charEnd: number;
};

function foldChar(ch: string): string {
  if (ch === "\u00a0" || ch === "\u202f" || ch === "\ufeff" || ch === "\u2007") return " ";
  if ("\u201c\u201d\u00ab\u00bb\u201e".includes(ch)) return '"';
  if ("\u2018\u2019\u201a\u2032".includes(ch)) return "'";
  if ("\u2013\u2014\u2212\u2015".includes(ch)) return "-";
  return ch;
}

export function normalizeForMatch(text: string): { norm: string; indexMap: number[] } {
  const indexMap: number[] = [];
  let norm = "";
  let prevSpace = true;

  for (let i = 0; i < text.length; i++) {
    const folded = foldChar(text[i] ?? "");
    if (/\s/.test(folded)) {
      if (!prevSpace && norm.length) {
        norm += " ";
        indexMap.push(i);
        prevSpace = true;
      }
      continue;
    }
    norm += folded.toLowerCase();
    indexMap.push(i);
    prevSpace = false;
  }

  if (norm.endsWith(" ")) {
    norm = norm.slice(0, -1);
    indexMap.pop();
  }

  return { norm, indexMap };
}

export function stripQuoteWrappers(raw: string): string {
  let q = raw.trim();
  q = q.replace(/^["'«»“”]+/, "").replace(/["'«»“”]+$/, "");
  q = q.replace(/\s*\[\s*\.\.\.\s*\]\s*/g, " ");
  q = q.replace(/\s*\.{3}\s*/g, " ");
  q = q.replace(/\s*…\s*/g, " ");
  return q.trim();
}

function pageForOffset(pages: PageSpan[], offset: number): number {
  for (const page of pages) {
    if (offset >= page.charStart && offset < page.charEnd) return page.pageNumber;
  }
  if (pages.length === 0) return 1;
  if (offset >= (pages[pages.length - 1]?.charEnd ?? 0)) {
    return pages[pages.length - 1]!.pageNumber;
  }
  return pages[0]!.pageNumber;
}

function excerptAround(text: string, start: number, end: number, pad = 90): string {
  const a = Math.max(0, start - pad);
  const b = Math.min(text.length, end + pad);
  const slice = text.slice(a, b).replace(/\s+/g, " ").trim();
  return `${a > 0 ? "…" : ""}${slice}${b < text.length ? "…" : ""}`;
}

function findAll(haystack: string, needle: string): number[] {
  if (!needle) return [];
  const out: number[] = [];
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    out.push(idx);
    from = idx + Math.max(1, needle.length);
  }
  return out;
}

function collapsePunct(norm: string): { compact: string; map: number[] } {
  const map: number[] = [];
  let compact = "";
  for (let i = 0; i < norm.length; i++) {
    const ch = norm[i]!;
    if (/[a-z0-9\u00c0-\u024f\u0400-\u04ff\u0600-\u06ff]/.test(ch) || ch === " ") {
      compact += ch;
      map.push(i);
    }
  }
  return { compact: compact.replace(/\s+/g, " ").trim() ? compact : compact, map };
}

function tokenWindows(norm: string, quoteNorm: string): number[] {
  const qTokens = quoteNorm.split(" ").filter((t) => t.length > 1);
  if (qTokens.length < 6) return [];
  const window = qTokens.slice(0, Math.min(12, qTokens.length)).join(" ");
  return findAll(norm, window);
}

export function locateQuote(
  documentText: string,
  quote: string,
  pages: PageSpan[],
  preferredOccurrence = 0,
): QuoteMatch | null {
  const cleaned = stripQuoteWrappers(quote);
  if (cleaned.replace(/\s+/g, "").length < 12) return null;

  const doc = normalizeForMatch(documentText);
  const q = normalizeForMatch(cleaned);

  if (q.norm.length < 12) return null;

  let hits = findAll(doc.norm, q.norm);

  if (hits.length === 0 && q.norm.length > 40) {
    const shorter = q.norm.slice(0, Math.min(180, q.norm.length));
    hits = findAll(doc.norm, shorter);
  }

  if (hits.length === 0) {
    const docC = collapsePunct(doc.norm);
    const qC = collapsePunct(q.norm);
    if (qC.compact.length >= 12) {
      const compactHits = findAll(docC.compact, qC.compact);
      hits = compactHits
        .map((h) => docC.map[h])
        .filter((n): n is number => typeof n === "number");
    }
  }

  if (hits.length === 0) {
    hits = tokenWindows(doc.norm, q.norm);
  }

  if (hits.length === 0) {
    const sentences = q.norm
      .split(/[.;:]/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 24);
    for (const sentence of sentences) {
      hits = findAll(doc.norm, sentence);
      if (hits.length) break;
    }
  }

  if (hits.length === 0) return null;

  const occurrence = Math.min(Math.max(0, preferredOccurrence), hits.length - 1);
  const normStart = hits[occurrence]!;
  const matchLen = Math.min(q.norm.length, doc.norm.length - normStart);
  const normEnd = Math.max(normStart, normStart + matchLen - 1);

  const start = doc.indexMap[normStart] ?? 0;
  const end = (doc.indexMap[normEnd] ?? start) + 1;
  const pageNumber = pageForOffset(pages, start);
  const pageEnd = pageForOffset(pages, Math.max(start, end - 1));
  const matchedText = documentText.slice(start, end);

  return {
    start,
    end,
    pageNumber,
    pageEnd,
    excerpt: excerptAround(documentText, start, end),
    occurrence,
    total: hits.length,
    matchedText,
  };
}

export function verifyQuotes(
  quotes: Array<{ text: string; documentId: string }>,
  documents: Array<{
    id: string;
    extractedText: string;
    pages: PageSpan[];
  }>,
) {
  const byId = new Map(documents.map((d) => [d.id, d]));
  const seen = new Set<string>();
  const verified: Array<{
    documentId: string;
    quoteText: string;
    match: QuoteMatch;
  }> = [];
  const unverified: Array<{ documentId: string; quoteText: string }> = [];

  for (const quote of quotes) {
    const key = `${quote.documentId}::${normalizeForMatch(quote.text).norm.slice(0, 180)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const doc = byId.get(quote.documentId);
    if (!doc) {
      unverified.push({ documentId: quote.documentId, quoteText: quote.text });
      continue;
    }
    const match = locateQuote(doc.extractedText, quote.text, doc.pages);
    if (match) verified.push({ documentId: quote.documentId, quoteText: quote.text, match });
    else unverified.push({ documentId: quote.documentId, quoteText: quote.text });
  }

  return { verified, unverified };
}

export function parseCitationsBlock(
  raw: string,
  fallbackDocumentId: string,
  knownIds: string[],
): { answer: string; quotes: Array<{ text: string; documentId: string }> } {
  const split = raw.split(/\n-{0,3}\s*CITATIONS\s*:?\s*\n/i);
  const answer = (split[0] || raw).trim();
  const block = split.slice(1).join("\n");
  const quotes: Array<{ text: string; documentId: string }> = [];

  if (block) {
    const lineRe =
      /(?:^|\n)\s*(?:[-*]|\d+[.)])?\s*(?:quote\s*:)?\s*["“]([\s\S]*?)["”]\s*(?:[\n,; ]*(?:document|doc|source|file)\s*[:=]\s*([^\n]+))?/gi;
    let m: RegExpExecArray | null;
    while ((m = lineRe.exec(block))) {
      const text = (m[1] || "").trim();
      const docRaw = (m[2] || "").trim();
      if (text.length < 8) continue;
      const documentId = resolveDocId(docRaw, fallbackDocumentId, knownIds);
      quotes.push({ text, documentId });
    }

    if (quotes.length === 0) {
      const quoted = block.match(/["“]([^"”]{12,})["”]/g) || [];
      for (const q of quoted) {
        quotes.push({
          text: q.replace(/^["“]|["”]$/g, ""),
          documentId: fallbackDocumentId,
        });
      }
    }
  }

  const inline = [...answer.matchAll(/\[\[quote(?::([^\]]+))?\]\]([\s\S]*?)\[\[\/quote\]\]/gi)];
  let cleaned = answer;
  for (const m of inline) {
    const text = (m[2] || "").trim();
    const docRaw = (m[1] || "").trim();
    if (text.length >= 8) {
      quotes.push({
        text,
        documentId: resolveDocId(docRaw, fallbackDocumentId, knownIds),
      });
    }
    cleaned = cleaned.replace(m[0], `"${text}"`);
  }

  return { answer: cleaned.trim(), quotes };
}

function resolveDocId(raw: string, fallback: string, knownIds: string[]): string {
  if (!raw) return fallback;
  const trimmed = raw.trim().replace(/^["']|["']$/g, "");
  if (knownIds.includes(trimmed)) return trimmed;
  const lower = trimmed.toLowerCase();
  const hit = knownIds.find((id) => id.toLowerCase() === lower);
  return hit || fallback;
}
