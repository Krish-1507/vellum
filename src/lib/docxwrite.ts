// Minimal .docx writer (stored ZIP entries). Enough for an answer export:
// headings, paragraphs, and a verified-quotes section.
import { zipStore } from "./zipstore";

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function para(text: string, opts: { bold?: boolean; size?: number; italic?: boolean } = {}) {
  const runs = text
    .split("\n")
    .map((line) => {
      const props =
        opts.bold || opts.size || opts.italic
          ? `<w:rPr>${opts.bold ? "<w:b/>" : ""}${opts.italic ? "<w:i/>" : ""}${opts.size ? `<w:sz w:val="${opts.size}"/><w:szCs w:val="${opts.size}"/>` : ""}</w:rPr>`
          : "";
      return `<w:r>${props}<w:t xml:space="preserve">${esc(line)}</w:t></w:r>`;
    })
    .join("");
  return `<w:p>${runs}</w:p>`;
}

export function buildAnswerDocx(input: {
  title: string;
  question: string;
  answer: string;
  coverageNote: string | null;
  citations: Array<{ quote: string; document: string; page: string }>;
  dropped: number;
}): Buffer {
  const body: string[] = [];
  body.push(para(input.title, { bold: true, size: 32 }));
  body.push(para(`Question: ${input.question}`));
  body.push(para("Answer", { bold: true, size: 26 }));
  for (const p of input.answer.split(/\n{2,}|\n/)) {
    if (p.trim()) body.push(para(p.trim()));
  }
  if (input.coverageNote) body.push(para(`Coverage note: ${input.coverageNote}`, { italic: true }));
  body.push(para("Verified quotes", { bold: true, size: 26 }));
  if (!input.citations.length) body.push(para("No verified quotes."));
  for (const c of input.citations) {
    body.push(para(`“${c.quote}”`));
    body.push(para(`— ${c.document}${c.page ? `, ${c.page}` : ""} (verified)`, { italic: true }));
  }
  if (input.dropped > 0) {
    body.push(
      para(
        `${input.dropped} citation${input.dropped === 1 ? "" : "s"} could not be verified against the document and were omitted.`,
        { italic: true },
      ),
    );
  }

  const documentXml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
    body.join("") +
    `</w:body></w:document>`;

  return zipStore([
    [
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.open-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    ],
    [
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    ],
    ["word/document.xml", documentXml],
  ]);
}
