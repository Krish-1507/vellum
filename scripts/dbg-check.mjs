// Debug: raw chat SSE dump + isolated compare call.
// Usage: node scripts/dbg-check.mjs <documentId>
import { writeFile } from "fs/promises";

const BASE = "http://127.0.0.1:3000";
const docId = process.argv[2];
if (!docId) throw new Error("pass a document id");

const r = await fetch(`${BASE}/api/chat`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ documentIds: [docId], message: "What is the liability cap?" }),
});
console.log("chat status:", r.status);
const text = await r.text();
await writeFile("data/chat-sse.log", text);
console.log("chat bytes:", text.length);
const events = {};
for (const chunk of text.split("\n\n")) {
  const m = chunk.match(/^event:\s*(\w+)/m);
  if (m) events[m[1]] = (events[m[1]] || 0) + 1;
}
console.log("events:", JSON.stringify(events));
const doneChunk = text.split("\n\n").find((c) => c.startsWith("event: done"));
console.log("done tail:", doneChunk ? doneChunk.slice(-300) : "MISSING");

console.log("--- compare ---");
const docs = await (await fetch(`${BASE}/api/documents`)).json();
const ready = (docs.documents || []).filter((d) => d.status === "ready");
console.log("ready docs:", ready.map((d) => d.name).join(", "));
const t0 = Date.now();
const cmpRes = await fetch(`${BASE}/api/compare`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ leftId: ready[0]?.id, rightId: ready[1]?.id }),
}).catch((e) => ({ ok: false, status: 0, _err: e.message }));
console.log("compare status:", cmpRes.status, `(${(Date.now() - t0) / 1000}s)`);
const cmpText = cmpRes.ok ? await cmpRes.text() : "";
console.log("compare bytes:", cmpText.length, cmpText.slice(0, 200));
