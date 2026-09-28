// Generates sample contracts for local testing and demo recordings.
// Usage: node scripts/make-sample-pdf.mjs
// Writes data/samples/contract-v1.pdf and data/samples/contract-v2.pdf
// (v2 moves the liability cap AED 100,000 -> AED 1,000,000 and extends the
// termination notice, so the Compare desk has something material to find).
import { mkdirSync, writeFileSync } from "fs";
import path from "path";

function escapePdf(s) {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

// Minimal valid PDF writer: Helvetica text, automatic page overflow.
function buildPdf(title, sections) {
  const innerWidth = 468; // points of usable width
  const left = 72;
  const top = 720;
  const lineH = 15;
  const paraGap = 9;

  // Flatten sections into positioned text runs.
  const pages = [[]];
  let y = top;
  const push = (text, size, bold) => {
    const words = text.split(" ");
    // Rough width estimate: 0.5 * size per char for Helvetica.
    const maxChars = Math.floor(innerWidth / (size * 0.48));
    let line = "";
    const lines = [];
    for (const w of words) {
      if ((line + " " + w).trim().length > maxChars) {
        lines.push(line.trim());
        line = w;
      } else {
        line = line ? `${line} ${w}` : w;
      }
    }
    if (line.trim()) lines.push(line.trim());
    for (const l of lines) {
      if (y < 72) {
        pages.push([]);
        y = top;
      }
      pages[pages.length - 1].push({ text: l, x: left, y, size, bold });
      y -= lineH;
    }
    y -= paraGap;
  };

  push(title, 18, true);
  for (const s of sections) {
    push(s.heading, 13, true);
    for (const p of s.paras) push(p, 10.5, false);
  }

  const objects = [];
  // 1: catalog, 2: pages, then per-page page+content, then font.
  const pageCount = pages.length;
  const pageObjNums = [];
  const contentObjNums = [];
  let next = 3;
  for (let i = 0; i < pageCount; i++) {
    pageObjNums.push(next++);
    contentObjNums.push(next++);
  }
  const fontObj = next++;

  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(" ")}] /Count ${pageCount} >>`;
  pages.forEach((runs, i) => {
    let stream = "";
    for (const r of runs) {
      stream += `BT /F1 ${r.size} Tf ${r.x} ${r.y} Td (${escapePdf(r.text)}) Tj ET\n`;
    }
    objects[contentObjNums[i]] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`;
    objects[pageObjNums[i]] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 ${fontObj} 0 R >> >> /Contents ${contentObjNums[i]} 0 R >>`;
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
  for (let i = 1; i < next; i++) {
    out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${next} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

const v1Sections = [
  {
    heading: "1. Services",
    paras: [
      "The Provider shall deliver the implementation services described in Schedule A (the Services) in a professional and workmanlike manner and in accordance with the milestones set out therein.",
    ],
  },
  {
    heading: "2. Payment",
    paras: [
      "The Client shall pay the Provider fees of AED 250,000 in three instalments against invoices issued on milestone acceptance. Invoices are payable within thirty days. Late payment bears interest at 5% per annum.",
    ],
  },
  {
    heading: "3. Limitation of liability",
    paras: [
      "The aggregate liability of the Provider under this Agreement shall not exceed AED 100,000. This cap is mutual and applies to both parties equally. Neither party shall be liable for indirect or consequential loss.",
    ],
  },
  {
    heading: "4. Termination",
    paras: [
      "Either party may terminate this Agreement for convenience on thirty days written notice. Termination for material breach requires fourteen days written notice and an opportunity to cure.",
    ],
  },
  {
    heading: "5. Confidentiality",
    paras: [
      "Each party shall keep confidential all non-public information received from the other party and shall not disclose it to any third party without prior written consent, for a period of three years after disclosure.",
    ],
  },
  {
    heading: "6. Governing law",
    paras: [
      "This Agreement is governed by the laws of the United Arab Emirates. Any dispute shall be referred to arbitration in Dubai under the DIAC Arbitration Rules, with the seat in Dubai.",
    ],
  },
];

const v2Sections = v1Sections.map((s) => ({ heading: s.heading, paras: [...s.paras] }));
v2Sections[2].paras = [
  "The aggregate liability of the Provider under this Agreement shall not exceed AED 1,000,000. This cap applies to the Provider only and is not mutual. Neither party shall be liable for indirect or consequential loss.",
];
v2Sections[3].paras = [
  "Either party may terminate this Agreement for convenience on ninety days written notice. Termination for material breach requires seven days written notice and an opportunity to cure.",
];
v2Sections.push({
  heading: "7. Non-compete",
  paras: [
    "During the term and for twelve months thereafter, the Provider shall not provide substantially similar services to any direct competitor of the Client listed in Schedule B.",
  ],
});

const dir = path.join(process.cwd(), "data", "samples");
mkdirSync(dir, { recursive: true });
writeFileSync(
  path.join(dir, "contract-v1.pdf"),
  buildPdf("MASTER SERVICES AGREEMENT (DRAFT v1)", v1Sections),
);
writeFileSync(
  path.join(dir, "contract-v2.pdf"),
  buildPdf("MASTER SERVICES AGREEMENT (DRAFT v2)", v2Sections),
);
console.log("Wrote data/samples/contract-v1.pdf and contract-v2.pdf");
