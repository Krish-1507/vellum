// Verifies extras: semantic vectors, export, anonymise, reprocess, /chat page.
// Usage: node scripts/verify-extras.mjs (dev :3000 + emulator up)
import { readFile, writeFile } from "fs/promises";

const BASE = "http://127.0.0.1:3000";
const results = [];
const ok = (id, pass, detail) => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"} ${id} — ${detail}`);
};

async function waitForServer(tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("no server");
}

async function upload(path, filename, mime) {
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
  if (!doc) throw new Error(`upload failed: ${errMsg}`);
  return doc;
}

async function chatOnce(documentIds, message) {
  const r = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ documentIds, message }),
  });
  const text = await r.text();
  let answer = "";
  let done = null;
  for (const chunk of text.split("\n\n")) {
    let event = null;
    for (const line of chunk.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) {
        const data = JSON.parse(line.slice(5).trim());
        if (event === "token") answer += data.text || "";
        if (event === "done") done = data;
      }
    }
  }
  return { answer, done };
}

await waitForServer();

// Semantic vectors cached at upload (check via export of chunk? use chat path instead:
// ask a conceptual question whose words don't overlap the clause text).
const v1 = await upload("data/samples/contract-v1.pdf", "contract-v1.pdf", "application/pdf");
{
  const q = await chatOnce([v1.id], "What is the liability cap? Quote it.");
  const cites = q.done?.message?.citations || [];
  ok("extras-chat-live", cites.length > 0, `${cites.length} verified citations`);
  // Export the answer as .docx
  const mid = q.done.message.id;
  const conv = q.done.message ? (await (await fetch(`${BASE}/api/conversations?documentId=${v1.id}`)).json()).conversation?.id : null;
  const ex = await fetch(`${BASE}/api/messages/${mid}/export?conversationId=${conv}`);
  const buf = Buffer.from(await ex.arrayBuffer());
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
  ok("extras-export-docx", ex.ok && isZip && buf.length > 2000, `status=${ex.status} bytes=${buf.length} zip=${isZip}`);
  await writeFile("data/answer-export-check.docx", buf);
}

// Anonymise: names doc -> toggle -> masked chat
const names = await upload("data/samples/names.pdf", "names.pdf", "application/pdf");
{
  const t = await fetch(`${BASE}/api/documents/${names.id}/anonymize`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ anonymized: true }),
  });
  const j = await t.json();
  const ents = j.entities || [];
  ok("extras-anon-entities", ents.length >= 3, `${ents.length} entities: ${ents.map((e) => e.token).join(",")}`);
  const q = await chatOnce([names.id], "Who are the parties? Quote the exact wording.");
  const masked = /\[PERSON_1\]|\[COMPANY_1\]|\[EMAIL_1\]|\[PHONE_1\]/.test(q.answer);
  const leaked = /Acme|John Smith|john@acme|971501234567/.test(q.answer);
  ok("extras-anon-masked", masked && !leaked, `masked=${masked} leaked=${leaked}`);
  // Reversible
  await fetch(`${BASE}/api/documents/${names.id}/anonymize`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ anonymized: false }),
  });
  const q2 = await chatOnce([names.id], "Who are the parties?");
  ok("extras-anon-reversible", /Acme/.test(q2.answer), `original restored`);
}

// Reprocess recovery: blank.pdf fails, then recovers with real bytes
{
  const blank = await upload("data/samples/blank.pdf", "blank.pdf", "application/pdf").catch(() => null);
  const list = await (await fetch(`${BASE}/api/documents`)).json();
  const failed = (list.documents || []).find((d) => d.originalFilename === "blank.pdf" && d.status !== "ready");
  const buf = await readFile("data/samples/contract-v1.pdf");
  const form = new FormData();
  form.append("file", new Blob([buf], { type: "application/pdf" }), "blank.pdf");
  const r = await fetch(`${BASE}/api/documents/${failed.id}/reprocess`, { method: "POST", body: form });
  const text = await r.text();
  const recovered = text.includes('"document"') || text.includes("event: done");
  const check = await (await fetch(`${BASE}/api/documents/${failed.id}`)).json();
  ok("extras-reprocess", check.document?.status === "ready", `status=${check.document?.status}`);
}

// /chat history page + search API
{
  const page = await fetch(`${BASE}/chat`);
  const search = await (await fetch(`${BASE}/api/conversations?q=liability`)).json();
  ok("extras-chat-page", page.status === 200 && Array.isArray(search.conversations), `page=${page.status} results=${search.conversations?.length}`);
}

const passed = results.filter(Boolean).length;
console.log(`\nEXTRAS: ${passed}/${results.length} passed`);
if (passed !== results.length) process.exit(1);
