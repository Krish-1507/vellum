import { writeFile } from "fs/promises";
import path from "path";
import type { ExtractedClause, OutlineEntry } from "@/lib/types";

export type ExtractedPage = {
  pageNumber: number;
  text: string;
  charStart: number;
  charEnd: number;
};

export type ExtractedChunk = {
  chunkIndex: number;
  heading: string | null;
  text: string;
  pageStart: number;
  pageEnd: number;
  charStart: number;
  charEnd: number;
};

export type Extraction = {
  text: string;
  html: string | null;
  pages: ExtractedPage[];
  chunks: ExtractedChunk[];
  outline: OutlineEntry[];
  clauses: ExtractedClause[];
  pageCount: number;
  charCount: number;
};

const HEADING_RE =
  /^(?:(?:article|section|clause|schedule|exhibit|appendix|part)\s+[0-9ivxlcdm]+(?:\.[0-9]+)*|[0-9]+(?:\.[0-9]+){0,3}|[A-Z][A-Z\s,&'/()-]{6,80})$/i;

const CLAUSE_KINDS: Array<{ kind: string; label: string; re: RegExp }> = [
  { kind: "termination", label: "Termination", re: /\bterminat(?:e|ion|ing)\b/i },
  { kind: "liability", label: "Limitation of liability", re: /\blimit(?:ation)? of liabilit|\bliabilit(?:y|ies)\b/i },
  { kind: "indemnity", label: "Indemnity", re: /\bindemnif/i },
  { kind: "governing_law", label: "Governing law", re: /\bgoverning law\b|\blaws of\b/i },
  { kind: "jurisdiction", label: "Jurisdiction / disputes", re: /\bjurisdiction\b|\barbitration\b|\bdispute resolution\b/i },
  { kind: "confidentiality", label: "Confidentiality", re: /\bconfidential/i },
  { kind: "payment", label: "Payment", re: /\b(?:fees?|payment|invoices?|consideration)\b/i },
  { kind: "ip", label: "Intellectual property", re: /\bintellectual property\b|\bcopyright\b|\btrademark\b/i },
  { kind: "warranty", label: "Warranties", re: /\bwarrant(?:y|ies|s)\b/i },
  { kind: "force_majeure", label: "Force majeure", re: /\bforce majeure\b/i },
  { kind: "assignment", label: "Assignment", re: /\bassign(?:ment|s)?\b/i },
  { kind: "insurance", label: "Insurance", re: /\binsurance\b/i },
  { kind: "non_compete", label: "Non-compete / non-solicit", re: /\bnon-?compete\b|\bnon-?solicit/i },
  { kind: "data", label: "Data protection", re: /\bdata protection\b|\bgdpr\b|\bpersonal data\b/i },
  { kind: "entire_agreement", label: "Entire agreement", re: /\bentire agreement\b/i },
  { kind: "notice", label: "Notices", re: /\bnotices?\b/i },
];

function readableCharCount(text: string) {
  return (text.match(/[\p{L}\p{N}]/gu) || []).length;
}

function isScannedOrEmpty(text: string, pageCount: number) {
  const readable = readableCharCount(text);
  if (readable < 40) return true;
  if (pageCount >= 3 && readable < 80) return true;
  return false;
}

export function chunkDocument(pages: ExtractedPage[]): ExtractedChunk[] {
  const TARGET = 1400;
  const chunks: ExtractedChunk[] = [];
  let buffer = "";
  let heading: string | null = null;
  let charStart = 0;
  let pageStart = pages[0]?.pageNumber ?? 1;
  let pageEnd = pageStart;
  let started = false;

  const flush = () => {
    const text = buffer.trim();
    if (!text) return;
    const start = charStart;
    const end = start + text.length;
    chunks.push({
      chunkIndex: chunks.length,
      heading,
      text,
      pageStart,
      pageEnd,
      charStart: start,
      charEnd: end,
    });
    buffer = "";
    started = false;
  };

  for (const page of pages) {
    const paras = page.text.split(/\n{2,}/);
    for (const para of paras) {
      const trimmed = para.trim();
      if (!trimmed) continue;
      const firstLine = trimmed.split("\n")[0]!.trim();
      if (HEADING_RE.test(firstLine) && firstLine.length < 90) {
        if (buffer.length > 200) flush();
        heading = firstLine.replace(/\s+/g, " ");
      }
      if (!started) {
        charStart = page.charStart + Math.max(0, page.text.indexOf(trimmed));
        pageStart = page.pageNumber;
        started = true;
      }
      pageEnd = page.pageNumber;
      buffer = buffer ? `${buffer}\n\n${trimmed}` : trimmed;
      if (buffer.length >= TARGET) flush();
    }
  }
  flush();
  return chunks;
}

function buildOutline(text: string, pages: ExtractedPage[]): OutlineEntry[] {
  const outline: OutlineEntry[] = [];
  const lines = text.split("\n");
  let offset = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && HEADING_RE.test(trimmed) && trimmed.length < 90) {
      const page = pages.find((p) => offset >= p.charStart && offset < p.charEnd);
      outline.push({
        heading: trimmed.replace(/\s+/g, " "),
        page: page?.pageNumber ?? 1,
        charStart: offset,
        charEnd: offset + line.length,
      });
    }
    offset += line.length + 1;
  }
  return outline.slice(0, 80);
}

function extractClauses(text: string, pages: ExtractedPage[]): ExtractedClause[] {
  const found: ExtractedClause[] = [];
  const used = new Set<string>();
  for (const def of CLAUSE_KINDS) {
    const match = def.re.exec(text);
    if (!match || match.index == null) continue;
    if (used.has(def.kind)) continue;
    used.add(def.kind);
    const start = Math.max(0, match.index - 40);
    const end = Math.min(text.length, match.index + 420);
    const page = pages.find((p) => match.index >= p.charStart && match.index < p.charEnd);
    found.push({
      kind: def.kind,
      label: def.label,
      page: page?.pageNumber ?? 1,
      excerpt: text.slice(start, end).replace(/\s+/g, " ").trim(),
      charStart: match.index,
      charEnd: match.index + match[0].length,
    });
  }
  return found;
}

function pagesFromText(text: string, pageSize = 3500): ExtractedPage[] {
  if (!text.trim()) return [];
  const pages: ExtractedPage[] = [];
  let cursor = 0;
  let n = 1;
  while (cursor < text.length) {
    let end = Math.min(text.length, cursor + pageSize);
    if (end < text.length) {
      const nl = text.lastIndexOf("\n\n", end);
      if (nl > cursor + pageSize * 0.5) end = nl;
    }
    const slice = text.slice(cursor, end);
    pages.push({
      pageNumber: n,
      text: slice,
      charStart: cursor,
      charEnd: end,
    });
    cursor = end;
    n += 1;
  }
  return pages;
}

function stitchPages(rawPages: string[]): ExtractedPage[] {
  const pages: ExtractedPage[] = [];
  let cursor = 0;
  rawPages.forEach((raw, i) => {
    const text = tidyPageText(raw);
    const start = cursor;
    const piece = i === 0 ? text : `\n\n${text}`;
    const charStart = i === 0 ? 0 : cursor + 2;
    cursor += piece.length;
    pages.push({
      pageNumber: i + 1,
      text,
      charStart,
      charEnd: cursor,
    });
    void start;
  });
  return pages;
}

function tidyPageText(raw: string) {
  return raw
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractPdf(buffer: Buffer): Promise<Extraction> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const result = await extractText(pdf, { mergePages: false });
  const rawPages = Array.isArray(result.text) ? result.text : [String(result.text || "")];
  const pages = stitchPages(rawPages.map((p) => String(p || "")));
  const text = pages.map((p) => p.text).join("\n\n");
  if (isScannedOrEmpty(text, pages.length || result.totalPages || 1)) {
    throw new ScannedPdfError();
  }
  return finalize(text, pages, null);
}

export async function extractDocx(buffer: Buffer): Promise<Extraction> {
  const mammothMod = await import("mammoth");
  const mammoth = mammothMod.default ?? mammothMod;
  const [raw, html] = await Promise.all([
    mammoth.extractRawText({ buffer }),
    mammoth.convertToHtml({ buffer }),
  ]);
  const text = tidyPageText(String(raw.value || ""));
  if (isScannedOrEmpty(text, 1)) {
    throw new EmptyDocumentError("No readable text could be extracted from this Word file.");
  }
  const pages = pagesFromText(text);
  return finalize(text, pages, html.value || null);
}

function finalize(text: string, pages: ExtractedPage[], html: string | null): Extraction {
  const chunks = chunkDocument(pages);
  return {
    text,
    html,
    pages,
    chunks,
    outline: buildOutline(text, pages),
    clauses: extractClauses(text, pages),
    pageCount: pages.length,
    charCount: text.length,
  };
}

export class ScannedPdfError extends Error {
  constructor() {
    super(
      "This PDF looks scanned — there is no readable text to extract. Export a text-based PDF or run OCR, then upload again.",
    );
    this.name = "ScannedPdfError";
  }
}

export class EmptyDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmptyDocumentError";
  }
}

export async function persistOriginal(storagePath: string, buffer: Buffer) {
  await writeFile(storagePath, buffer);
}

export function originalPath(dir: string, filename: string) {
  return path.join(dir, filename);
}
