import { locateQuote, normalizeForMatch, stripQuoteWrappers } from "./quotes";

export type HighlightRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type PdfGlyph = {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export function rectsForQuote(
  glyphs: PdfGlyph[],
  quote: string,
  pageWidth: number,
  pageHeight: number,
  occurrence = 0,
): HighlightRect[] {
  if (!glyphs.length || !quote.trim()) return [];

  let joined = "";
  const spans: Array<{ start: number; end: number; g: PdfGlyph }> = [];
  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i]!;
    const prev = glyphs[i - 1];
    if (prev) {
      const sameLine = Math.abs(prev.y - g.y) < Math.max(prev.h, g.h) * 0.6;
      const gap = g.x - (prev.x + prev.w);
      const needSpace = !prev.str.endsWith(" ") && !g.str.startsWith(" ") && (!sameLine || gap > prev.h * 0.25);
      if (needSpace) joined += " ";
    }
    const start = joined.length;
    joined += g.str;
    spans.push({ start, end: joined.length, g });
  }

  const match = locateQuote(joined, quote, [{ pageNumber: 1, charStart: 0, charEnd: joined.length }], occurrence);
  if (!match) {
    const norm = normalizeForMatch(joined);
    const q = normalizeForMatch(stripQuoteWrappers(quote)).norm;
    if (!q || q.length < 8) return [];
    const idx = norm.norm.indexOf(q.slice(0, Math.min(q.length, 80)));
    if (idx < 0) return [];
    const start = norm.indexMap[idx] ?? 0;
    const end = (norm.indexMap[idx + Math.min(q.length, 80) - 1] ?? start) + 1;
    return rectsFromRange(spans, start, end, pageWidth, pageHeight);
  }
  return rectsFromRange(spans, match.start, match.end, pageWidth, pageHeight);
}

function rectsFromRange(
  spans: Array<{ start: number; end: number; g: PdfGlyph }>,
  start: number,
  end: number,
  pageWidth: number,
  pageHeight: number,
): HighlightRect[] {
  const hits = spans.filter((s) => s.end > start && s.start < end && s.g.str.trim());
  const lineBuckets = new Map<number, PdfGlyph[]>();
  for (const h of hits) {
    const key = Math.round(h.g.y * 2) / 2;
    const arr = lineBuckets.get(key) || [];
    arr.push(h.g);
    lineBuckets.set(key, arr);
  }
  const rects: HighlightRect[] = [];
  for (const line of lineBuckets.values()) {
    const minX = Math.min(...line.map((g) => g.x));
    const maxX = Math.max(...line.map((g) => g.x + g.w));
    const minY = Math.min(...line.map((g) => g.y));
    const maxY = Math.max(...line.map((g) => g.y + g.h));
    const padY = Math.max(1, (maxY - minY) * 0.12);
    rects.push({
      left: (minX / pageWidth) * 100,
      top: (minY / pageHeight) * 100,
      width: ((maxX - minX) / pageWidth) * 100,
      height: ((maxY - minY + padY * 2) / pageHeight) * 100,
    });
  }
  return rects;
}

export function wrapTextQuote(root: HTMLElement, quote: string) {
  root.querySelectorAll("mark.vellum-hit").forEach((el) => {
    const parent = el.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(el.textContent || ""), el);
    parent.normalize();
  });

  const cleaned = stripQuoteWrappers(quote);
  if (cleaned.length < 8) return null;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let joined = "";
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!node.nodeValue) continue;
    nodes.push(node);
    joined += node.nodeValue;
  }

  const match = locateQuote(joined, cleaned, [{ pageNumber: 1, charStart: 0, charEnd: joined.length }]);
  if (!match) return null;

  let cursor = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;
  for (const node of nodes) {
    const len = node.nodeValue?.length || 0;
    if (!startNode && match.start >= cursor && match.start < cursor + len) {
      startNode = node;
      startOffset = match.start - cursor;
    }
    if (match.end > cursor && match.end <= cursor + len) {
      endNode = node;
      endOffset = match.end - cursor;
      break;
    }
    cursor += len;
  }
  if (!startNode || !endNode) return null;

  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  const mark = document.createElement("mark");
  mark.className = "vellum-hit";
  try {
    range.surroundContents(mark);
  } catch {
    const contents = range.extractContents();
    mark.appendChild(contents);
    range.insertNode(mark);
  }
  return mark;
}
