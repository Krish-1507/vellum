// Debugs anonymise masking: prints doc flags, entities, and the raw answer.
const BASE = "http://127.0.0.1:3000";
const docs = await (await fetch(`${BASE}/api/documents`)).json();
const names = (docs.documents || []).find((d) => d.originalFilename === "names.pdf");
console.log("before:", names?.id, "anonymized=", names?.anonymized, "entityCount=", names?.entityCount);
const t = await fetch(`${BASE}/api/documents/${names.id}/anonymize`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ anonymized: true }),
});
const tj = await t.json();
console.log("toggle:", JSON.stringify(tj.document), "entities:", (tj.entities || []).length);
const full = await (await fetch(`${BASE}/api/documents/${names.id}`)).json();
const r = await fetch(`${BASE}/api/chat`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ documentIds: [names.id], message: "Who are the parties? Quote the exact wording." }),
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
console.log("ANSWER:", JSON.stringify(answer.slice(0, 500)));
console.log("CITES:", JSON.stringify(done?.message?.citations?.map((c) => c.quoteText).slice(0, 2), null, 1)?.slice(0, 600));
