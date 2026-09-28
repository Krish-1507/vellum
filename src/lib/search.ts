import type { DocumentChunkRow, DocumentRow } from "@/db/schema";

const STOP = new Set([
  "the",
  "and",
  "for",
  "that",
  "with",
  "this",
  "from",
  "shall",
  "will",
  "are",
  "was",
  "were",
  "not",
  "any",
  "all",
  "may",
  "its",
  "his",
  "her",
  "their",
  "into",
  "such",
  "under",
  "over",
  "upon",
  "been",
  "have",
  "has",
  "had",
  "but",
  "or",
  "if",
  "of",
  "to",
  "in",
  "on",
  "by",
  "as",
  "at",
  "a",
  "an",
  "be",
  "is",
  "it",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export type SearchHit = {
  documentId: string;
  documentName: string;
  chunkIndex: number;
  heading: string | null;
  pageStart: number;
  pageEnd: number;
  text: string;
  score: number;
};

export function searchChunks(
  query: string,
  docs: Array<{ document: DocumentRow; chunks: DocumentChunkRow[] }>,
  limit = 8,
): SearchHit[] {
  const qTokens = tokenize(query);
  const phrase = query.toLowerCase().replace(/\s+/g, " ").trim();
  const hits: SearchHit[] = [];

  for (const { document, chunks } of docs) {
    const df = new Map<string, number>();
    for (const chunk of chunks) {
      const uniq = new Set(tokenize(chunk.text));
      for (const t of uniq) df.set(t, (df.get(t) || 0) + 1);
    }
    const n = Math.max(1, chunks.length);

    for (const chunk of chunks) {
      const tokens = tokenize(chunk.text);
      if (!tokens.length) continue;
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
      let score = 0;
      for (const qt of qTokens) {
        const f = tf.get(qt) || 0;
        if (!f) continue;
        const idf = Math.log(1 + n / (1 + (df.get(qt) || 0)));
        score += (1 + Math.log(f)) * idf;
      }
      const hay = chunk.text.toLowerCase().replace(/\s+/g, " ");
      if (phrase.length > 4 && hay.includes(phrase)) score += 6;
      if (chunk.heading && qTokens.some((t) => chunk.heading!.toLowerCase().includes(t))) {
        score += 2;
      }
      if (score > 0) {
        hits.push({
          documentId: document.id,
          documentName: document.name,
          chunkIndex: chunk.chunkIndex,
          heading: chunk.heading,
          pageStart: chunk.pageStart,
          pageEnd: chunk.pageEnd,
          text: chunk.text,
          score,
        });
      }
    }
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

export function pagesFor(document: DocumentRow, pageStart: number, pageEnd: number, pageTexts: Array<{ pageNumber: number; text: string }>) {
  const from = Math.max(1, pageStart);
  const to = Math.min(document.pageCount || pageEnd, pageEnd);
  return pageTexts
    .filter((p) => p.pageNumber >= from && p.pageNumber <= to)
    .map((p) => `--- page ${p.pageNumber} ---\n${p.text}`)
    .join("\n\n");
}
