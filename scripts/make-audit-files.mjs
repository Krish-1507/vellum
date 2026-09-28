// Builds audit fixtures: blank.pdf (no text), big150.pdf (150 pages), sample.docx.
// Usage: node scripts/make-audit-files.mjs
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { crc32, zipStore } from "./zipstore.mjs";

const dir = path.join(process.cwd(), "data", "samples");
mkdirSync(dir, { recursive: true });

function pdfDoc(pages) {
  // pages: array of arrays of {text, size}
  const objects = [];
  let next = 3;
  const pageNums = [];
  const contentNums = [];
  for (let i = 0; i < pages.length; i++) {
    pageNums.push(next++);
    contentNums.push(next++);
  }
  const fontObj = next++;
  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  pages.forEach((runs, i) => {
    let stream = "";
    for (const r of runs) {
      const t = r.text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
      stream += `BT /F1 ${r.size} Tf 72 ${r.y} Td (${t}) Tj ET\n`;
    }
    objects[contentNums[i]] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`;
    objects[pageNums[i]] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 ${fontObj} 0 R >> >> /Contents ${contentNums[i]} 0 R >>`;
  });
  objects[fontObj] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;
  let out = `%PDF-1.4\n`;
  const offsets = [0];
  for (let i = 1; i < next; i++) {
    offsets[i] = Buffer.byteLength(out);
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefAt = Buffer.byteLength(out);
  out += `xref\n0 ${next}\n0000000000 65535 f \n`;
  for (let i = 1; i < next; i++) out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${next} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

// Blank: content stream with no text operators (simulates a scanned page).
writeFileSync(path.join(dir, "blank.pdf"), pdfDoc([[ ]]));
console.log("wrote blank.pdf");

// 150 pages of contract-ish text with varied clauses.
const topics = [
  ["Payment", "The Client shall pay fees of AED {n},000 within thirty days of invoice. Late payment bears interest at 5% per annum."],
  ["Liability", "Neither party shall be liable for indirect loss. The aggregate cap is AED {n},000 and applies mutually."],
  ["Termination", "Either party may terminate for convenience on {n} days written notice after an opportunity to cure."],
  ["Confidentiality", "Each party keeps non-public information confidential for {n} years after disclosure."],
  ["Governing law", "This Agreement is governed by the laws of the United Arab Emirates with arbitration in Dubai."],
  ["Warranties", "The Provider warrants the Services will conform to Schedule A for {n} months after acceptance."],
];
const pages = [];
for (let p = 1; p <= 150; p++) {
  const runs = [{ text: `Schedule ${p} — Supplementary Terms (page ${p} of 150)`, size: 13, y: 720 }];
  let y = 690;
  for (let k = 0; k < 4; k++) {
    const t = topics[(p + k) % topics.length];
    runs.push({ text: `${t[0]} ${p}.${k}`, size: 11, y });
    y -= 18;
    runs.push({ text: t[1].replace("{n}", String(10 + ((p * 7 + k * 13) % 80))), size: 10, y });
    y -= 30;
  }
  pages.push(runs);
}
writeFileSync(path.join(dir, "big150.pdf"), pdfDoc(pages));
console.log("wrote big150.pdf");

// Minimal Word file (stored ZIP entries, no compression needed for mammoth).
const docXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
  [
    "MASTER SERVICES AGREEMENT (WORD VERSION)",
    "The aggregate liability of the Provider under this Agreement shall not exceed AED 100,000. This cap is mutual and applies to both parties equally.",
    "Either party may terminate this Agreement for convenience on thirty days written notice.",
    "This Agreement is governed by the laws of the United Arab Emirates.",
  ]
    .map((t) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`)
    .join("") +
  `</w:body></w:document>`;
const files = [
  ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.open-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`],
  ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`],
  ["word/document.xml", docXml],
];
writeFileSync(path.join(dir, "sample.docx"), zipStore(files));
console.log("wrote sample.docx, crc check:", crc32("test"));
