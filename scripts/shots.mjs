// Captures README screenshots against a running dev server.
// Usage: node scripts/shots.mjs   (dev on :3000, DB up with sample docs)
import { mkdirSync } from "fs";
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:3000";
const out = "docs/screenshots";
mkdirSync(out, { recursive: true });

const docs = await (await fetch(`${BASE}/api/documents`)).json();
const ready = (docs.documents || []).filter((d) => d.status === "ready");
if (ready.length < 2) throw new Error("need 2 ready documents");

// Prefer a document that already has verified citations for the chat shots.
let first = ready[0];
for (const d of ready) {
  try {
    const c = await (await fetch(`${BASE}/api/conversations?documentId=${d.id}`)).json();
    if ((c.messages || []).some((m) => (m.citations || []).length > 0)) {
      first = d;
      break;
    }
  } catch {}
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

// 1. Library
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/library.png` });

// 2. Chat with verified quotes
await page.goto(`${BASE}/d/${first.id}`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/chat.png` });

// 3. Citation highlighting: click the first "Open" citation.
const openBtn = page.getByRole("button", { name: /open/i }).first();
if ((await openBtn.count()) > 0) {
  await openBtn.click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${out}/highlight.png` });
} else {
  await page.screenshot({ path: `${out}/highlight.png` });
}

// 4. Comparison: run it in the UI.
await page.goto(`${BASE}/compare`, { waitUntil: "networkidle" });
await page.waitForSelector("select option", { timeout: 30000, state: "attached" });
await page.waitForTimeout(800);
await page.getByTestId("run-compare").click();
await page.waitForSelector("text=In substance", { timeout: 120000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/compare.png` });

await browser.close();
console.log("screenshots written to", out);
