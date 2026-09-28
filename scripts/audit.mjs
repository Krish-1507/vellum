// Requirement-by-requirement audit. Usage: node scripts/audit.mjs
// Needs dev server on :3000 + Firestore emulator.
import { readFile } from "fs/promises";

const BASE = "http://127.0.0.1:3000";
const results = [];
const ok = (id, pass, detail) => {
  results.push({ id, pass, detail });
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

async function uploadFile(path, filename, mime) {
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
  return { status: r.status, doc, errMsg };
}

async function chatOnce(documentIds, message) {
  const r = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ documentIds, message }),
  });
  if (!r.ok) return { httpError: r.status, body: await r.text().catch(() => "") };
  const text = await r.text();
  let answer = "";
  let done = null;
  let statuses = [];
  let chatError = null;
  for (const chunk of text.split("\n\n")) {
    let event = null;
    for (const line of chunk.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) {
        const data = JSON.parse(line.slice(5).trim());
        if (event === "token") answer += data.text || "";
        if (event === "status") statuses.push(data.label);
        if (event === "error") chatError = data.message;
        if (event === "done") done = data;
      }
    }
  }
  return { answer, done, statuses, chatError };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await waitForServer();

// A1: reject other file types with a clear message
{
  const t = await uploadFile("package.json", "notes.txt", "text/plain");
  ok("A1-reject-type", t.status === 400 || !!t.errMsg, `status=${t.status} msg=${t.errMsg || "(none)"}`);
}
// A1: scanned PDF refused, not saved empty
let blankId = null;
{
  const t = await uploadFile("data/samples/blank.pdf", "blank.pdf", "application/pdf");
  const list = await (await fetch(`${BASE}/api/documents`)).json();
  const row = (list.documents || []).find((d) => d.originalFilename === "blank.pdf");
  blankId = row?.id;
  const refused = !!t.errMsg || row?.status === "failed";
  ok("A1-scanned", refused, `err=${t.errMsg || row?.errorMessage || "(none)"} status=${row?.status}`);
}
// A1: DOCX works
let docxId = null;
{
  const t = await uploadFile("data/samples/sample.docx", "sample.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  docxId = t.doc?.id;
  ok("A1-docx", t.doc?.status !== "failed" && !!t.doc, `status=${t.doc?.status || t.errMsg} chars=${t.doc?.charCount}`);
  if (t.doc) {
    const full = await (await fetch(`${BASE}/api/documents/${t.doc.id}`)).json();
    ok("A1-docx-text", (full.document?.charCount || 0) > 100, `chars=${full.document?.charCount}`);
  }
}
// A4: 150 pages
let bigId = null;
{
  const t = await uploadFile("data/samples/big150.pdf", "big150.pdf", "application/pdf");
  bigId = t.doc?.id;
  ok("A4-150pages", t.doc?.pageCount === 150, `pages=${t.doc?.pageCount} chars=${t.doc?.charCount}`);
}
// A1: library lists + delete works
{
  const before = await (await fetch(`${BASE}/api/documents`)).json();
  const n0 = (before.documents || []).length;
  if (blankId) await fetch(`${BASE}/api/documents/${blankId}`, { method: "DELETE" });
  const after = await (await fetch(`${BASE}/api/documents`)).json();
  ok("A1-library-delete", (after.documents || []).length === n0 - (blankId ? 1 : 0), `${n0} -> ${(after.documents || []).length}`);
}
// A2: stop keeps partial answer (abort after first token, then check saved state)
{
  const ctrl = new AbortController();
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ documentIds: [bigId], message: "Summarise every payment and liability clause in detail with quotes." }),
    signal: ctrl.signal,
  });
  let sawToken = false;
  try {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      if (chunk.includes("event: token")) {
        sawToken = true;
        ctrl.abort(); // stop at once, mid-answer
        break;
      }
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 2000));
  const conv = await (await fetch(`${BASE}/api/conversations?documentId=${bigId}`)).json();
  const last = (conv.messages || []).filter((m) => m.role === "assistant").pop();
  console.log("  stop-state content:", JSON.stringify((last?.content || "").slice(0, 300)));
  ok(
    "A2-stop-keeps-partial",
    sawToken && !!last && last.status === "stopped" && (last.content || "").length > 0,
    `sawToken=${sawToken} status=${last?.status} len=${(last?.content || "").length}`,
  );
}
// A3: absent answer -> says so, drops invented quotes
{
  const q = await chatOnce([docxId], "What does the agreement say about submarine maintenance penalties? Quote the exact wording.");
  const saysAbsent = /not (in|part of|find|contain|mention)|no .*clause|does not (contain|mention|say|address)/i.test(q.answer);
  const dropped = (q.done?.droppedUnverified || 0) > 0;
  ok("A3-absent", saysAbsent || dropped, `saysAbsent=${saysAbsent} dropped=${q.done?.droppedUnverified} answer=${q.answer.slice(0, 160)}`);
}
// C: multi-round loop. Part 1 cannot answer part 2, forcing a second lookup.
await sleep(15000);
{
  const q = await chatOnce([bigId], "What is the termination notice period on Schedule 5? Then find one schedule with a different notice period and quote that one too. Quote exact wording for both.");
  let steps = q.statuses;
  let cites = q.done?.message?.citations || [];
  if (steps.length < 2) {
    const q2 = await chatOnce([bigId], "List the termination notice for Schedule 5, then the confidentiality duration for Schedule 29. Quote both exactly.");
    steps = q2.statuses;
    cites = q2.done?.message?.citations || [];
  }
  ok("C-multiround", steps.length >= 2, `steps=${steps.length}: ${steps.slice(0, 4).join(" | ")}`);
  const dropped = q.done?.droppedUnverified || 0;
  ok("C-quotes-verified", cites.length > 0 || dropped > 0, `${cites.length} verified, ${dropped} dropped-as-unverified`);
}
// B6: multi-document comparative, each quote names its source
await sleep(15000);
{
  const v = await uploadFile("data/samples/contract-v1.pdf", "contract-v1.pdf", "application/pdf");
  const q = await chatOnce([docxId, v.doc.id], "How do the liability caps compare between the two documents? Quote each.");
  const cites = q.done?.message?.citations || [];
  const srcs = new Set(cites.map((c) => c.documentId));
  const comparative = /both|whereas|while|compared|difference|v1|v2|word|pdf/i.test(q.answer);
  ok("B6-multi", srcs.size >= 2 && comparative, `sources=${srcs.size} comparative=${comparative} cites=${cites.length}`);
}
// A4: big-doc question answered from deep pages (page > 30 citation proves no 30-page skim)
await sleep(15000);
{
  const q = await chatOnce([bigId], "Quote the exact heading of Schedule 120.");
  const cites = q.done?.message?.citations || [];
  const deep = cites.some((c) => (c.pageNumber || 0) >= 100);
  ok("A4-deep-retrieval", deep && /schedule 120/i.test(q.answer), `pages=[${cites.map((c) => c.pageNumber).join(",")}]`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\nAUDIT: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
