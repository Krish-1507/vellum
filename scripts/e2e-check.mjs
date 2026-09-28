// End-to-end check: upload v1+v2, process, chat (real AI), compare.
// Usage: node scripts/e2e-check.mjs   (dev server must be running on :3000)
const BASE = "http://127.0.0.1:3000";

async function waitForServer(tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok || r.status === 503) return await r.json();
    } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("dev server never came up");
}

async function upload(path, filename, mime) {
  const { readFile } = await import("fs/promises");
  const buf = await readFile(path);
  const form = new FormData();
  form.append("file", new Blob([buf], { type: mime }), filename);
  const r = await fetch(`${BASE}/api/documents`, { method: "POST", body: form });
  const text = await r.text();
  let doc = null;
  let errMsg = null;
  for (const chunk of text.split("\n\n")) {
    for (const line of chunk.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const data = JSON.parse(line.slice(5).trim());
      if (data.document) doc = data.document;
      if (data.message && !data.document) errMsg = data.message;
    }
  }
  if (!doc) throw new Error(`upload failed: ${errMsg || r.status}`);
  return doc;
}

async function processDoc(id) {
  // Upload endpoint already extracts; just confirm final state.
  const d = await (await fetch(`${BASE}/api/documents/${id}`)).json();
  return { ok: d.document?.status === "ready", status: d.document?.status, pages: d.document?.pageCount, chars: d.document?.charCount };
}

async function chat(documentIds, message) {
  const r = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ documentIds, message }),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(`chat failed (${r.status}): ${j.error || "?"}`);
  }
  const text = await r.text();
  let answer = "";
  let done = null;
  let chatError = null;
  let statuses = [];
  for (const chunk of text.split("\n\n")) {
    let event = null;
    for (const line of chunk.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) {
        const data = JSON.parse(line.slice(5).trim());
        if (event === "token") answer += data.text || "";
        if (event === "status") statuses.push(data.label);
        if (event === "error") chatError = data.message || "unknown";
        if (event === "done") done = data;
      }
    }
  }
  return { answer, done, statuses, chatError };
}

const health = await waitForServer();
console.log("HEALTH:", JSON.stringify(health));

const v1 = await upload("data/samples/contract-v1.pdf", "contract-v1.pdf", "application/pdf");
console.log("UPLOADED v1:", v1.id, v1.name);
const p1 = await processDoc(v1.id);
console.log("PROCESSED v1:", JSON.stringify(p1));

const v2 = await upload("data/samples/contract-v2.pdf", "contract-v2.pdf", "application/pdf");
console.log("UPLOADED v2:", v2.id, v2.name);
const p2 = await processDoc(v2.id);
console.log("PROCESSED v2:", JSON.stringify(p2));

const q = await chat([v1.id], "What is the liability cap, and is it mutual? Quote the exact wording.");
console.log("AGENT STEPS:", q.statuses.join(" | "));
console.log("CHAT ERROR:", q.chatError);
console.log("ANSWER:", q.answer.slice(0, 900));
console.log("CITATIONS:", JSON.stringify(q.done?.message?.citations, null, 1)?.slice(0, 1200));
console.log("DROPPED:", q.done?.droppedUnverified);

const cmpRes = await fetch(`${BASE}/api/compare`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ leftId: v1.id, rightId: v2.id }),
});
const cmp = await cmpRes.json();
if (!cmpRes.ok) throw new Error(`compare failed: ${cmp.error}`);
console.log("COMPARE SUMMARY:", cmp.comparison.summary.slice(0, 600));
console.log(
  "CHANGES:",
  cmp.comparison.changes.map((c) => `${c.significance}/${c.changeType}: ${c.title}`).join(" || "),
);
console.log("E2E DONE");
