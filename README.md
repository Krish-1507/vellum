# Vellum — Contract Desk

Upload a contract, ask what it actually says, and get answers that only stand if the quote can be found in the document. Click any citation to open the passage highlighted on the page.

**Live:** https://vellum-fawn-xi.vercel.app/ · **Repo:** https://github.com/Krish-1507/vellum

Built for the engineering assignment below. Parts A, B, and C (Option 2) are implemented and verified end-to-end — see [Verification](#verification). No accounts; single user.

## Contents

- [What it does](#what-it-does) — feature checklist mapped to the assignment
- [Screenshots](#screenshots)
- [Run it locally](#run-it-locally)
- [Configuration](#configuration)
- [Architecture](#architecture)
- [Verification](#verification)
- [Deploy](#deploy)
- [What is finished and what is not](#what-is-finished-and-what-is-not)

## What it does

### Part A — Core

**A1 · Upload and processing** (`src/app/api/documents/route.ts`, `src/lib/process.ts`, `src/lib/extract.ts`)
- Accepts PDF and `.docx`; anything else is rejected with a plain message, client-side and server-side.
- Text, per-page spans, clause chunks, outline, and detected clauses are extracted and stored.
- Progress streams over SSE (`Uploading… → Extracting text… → Indexed N pages… → Ready`), plus an in-browser progress bar — the user is never left guessing.
- A scanned PDF with no readable text is refused with guidance (`ScannedPdfError`), never saved as an empty “success”.
- The library lists every file with type, size, page count and status; files open into the workspace and delete cleanly (Firestore data + browser original together).

**A2 · Chat** (`src/components/ChatPane.tsx`, `src/app/api/chat/route.ts`)
- Answers stream token-by-token as SSE; a live activity feed shows the agent's tool calls (“Searching for liability cap…”), not a spinner.
- Stop mid-answer keeps everything generated so far (message persisted with `stopped` status — covered by audit `A2-stop-keeps-partial`).
- History is stored per document (single mode) or per document set (multi mode) and reloads on revisit.

**A3 · Verified quotes** (`src/lib/quotes.ts`, `src/lib/agent.ts`) — the load-bearing requirement
- The model must emit a `CITATIONS:` block; every quote is then located in the stored document text **by our code**, never by trusting model offsets or page numbers.
- Matching is whitespace-normalised (spaces, line breaks, NBSPs, curly quotes/dashes folded), with punctuation-stripped, token-window, and per-sentence fallbacks.
- Verified quotes render with page numbers and open in the document; invented or paraphrased quotes are dropped and counted (`“N citations could not be found…”`), never shown as genuine.
- Each quote is verified against **its own** document. If the answer is not in the document, the model is instructed to say so — and does (audit `A3-absent`).

**A4 · Large documents** (`src/lib/extract.ts`, `src/lib/agent.ts`)
- Documents are split into ~1,400-character chunks; the model never receives the whole file. It retrieves via tools over the full chunk set.
- Coverage honesty: a full-document `search_document` counts as coverage; paging a slice does not. Partial retrieval marks the answer `partial` with a visible warning that absence of a clause is not certain. Proven by retrieving a heading from page 120 of a 150-page file (audit `A4-deep-retrieval`).

### Part B — Advanced

**B5 · Citation highlighting** (`src/components/PdfViewer.tsx`, `src/lib/highlight.ts`, `src/components/DocxViewer.tsx`)
- Clicking a quote jumps to its page, scrolls to the passage, and paints it. PDF mapping is glyph-level (independent of extraction layout); Word mapping is a text-range wrap. Multi-line quotes, page breaks, and repeat occurrences (occurrence index) are handled.

**B6 · Multi-document questions** (`src/components/MultiAsk.tsx`, `src/app/api/ask/page.tsx`)
- Select several files, ask once. The prompt demands one comparative answer, not per-file memos; every citation names its source document and is verified against that document only.

**B7 · Comparison** (`src/components/CompareDesk.tsx`, `src/lib/compare.ts`)
- Clause/paragraph-level diff (heading-aware blocks with Jaccard matching), never a character diff. Significance scoring weights money figures, liability, termination, forum, and restrictive covenants; rewording without substance changes scores low.
- A plain-language substance summary (AI with a deterministic fallback), filterable by high / medium / low, sorted by significance score.

### Part C — Option 2: Agentic document research

Chosen over tracked-change redlining because it is the same problem as large-document honesty — the model should look things up and the product should show that work — while DOCX XML surgery (`w:ins`/`w:del` across split runs) is a separate craft where a fake “regenerate and diff” would fail the brief.

- Real multi-round loop: `search_document`, `get_section`, `list_clauses`, `get_pages`; the model calls tools, reads results, and calls more (observed: 4-step runs mixing search and page reads).
- Live status per call, hard cap of 6 rounds with a forced answer from retrieved passages, malformed/unknown tool calls returned as JSON errors — never a crash.
- Verified quotes apply to the final answer exactly as in single mode.

## Screenshots

![Library and upload](docs/screenshots/library.png)

![Chat with verified quotes](docs/screenshots/chat.png)

![Citation highlighting](docs/screenshots/highlight.png)

![Document comparison](docs/screenshots/compare.png)

## Run it locally

Prerequisites: Node 22+, npm, Java 17+ (Firestore emulator only).

```bash
npm install
cp .env.example .env   # then set GROQ_API_KEY (below)
npm run db:emulator     # terminal 1 — local Firestore on :8080
npm run dev             # terminal 2 — http://localhost:3000
```

No Postgres, no migrations, no Docker. Structured data lives in Firestore (emulator locally, `vellum-project` in production); original file bytes stay in the browser's IndexedDB, so the server is stateless.

Try the whole assignment in minutes:

```bash
node scripts/make-sample-pdf.mjs   # data/samples/contract-v1.pdf + contract-v2.pdf
node scripts/make-audit-files.mjs  # blank.pdf, big150.pdf (150 pages), sample.docx
node scripts/audit.mjs             # 12-check requirement audit (needs dev server + GROQ_API_KEY)
```

## Configuration

| Variable | Purpose |
| --- | --- |
| `GROQ_API_KEY` | AI key, free tier ([console.groq.com](https://console.groq.com)). Default model `openai/gpt-oss-120b`: 131k context, native tool use, ~$0.15/$0.60 per 1M tokens |
| `AI_API_KEY` / `AI_BASE_URL` / `AI_MODEL` | Any other OpenAI-compatible provider (commented out = Groq defaults) |
| `FIREBASE_PROJECT_ID` | `vellum-project` in production |
| `FIRESTORE_EMULATOR_HOST` | `127.0.0.1:8080` for local dev; unset in production |
| `FIREBASE_SERVICE_KEY` | Production only: full service-account JSON (Vercel env var). Local emulator needs nothing |

Notes: output is capped at 1024 tokens and tool payloads at ~2,500 chars so free-tier quotas survive real sessions; 429s are retried with the provider's wait time. A Groq key pointed at OpenAI's URL (or vice versa) fails fast with a plain message, not a cryptic 401.

## Architecture

```
browser (Next.js) ── upload bytes ──▶ /api/documents (SSE: extract → Firestore)
       │                                     │
       │ IndexedDB (originals)               ▼ Firestore (Native, asia-south1)
       │                               documents + pages/chunks (subcollections)
chat ──┴──▶ /api/chat (SSE: tokens, tool status, done)
              │ runAgent: up to 6 rounds of search/get_section/list_clauses/get_pages
              │ verifyQuotes: every citation located in its own document's text
              ▼ citations stored per message; unverified ones recorded as omitted
compare ──▶ /api/compare → clause diff + significance + substance summary
```

Key files: `src/lib/agent.ts` (tool loop), `src/lib/quotes.ts` (verifier), `src/lib/store.ts` (Firestore layer), `src/lib/highlight.ts` (PDF glyph mapping), `src/lib/compare.ts` (diff + scoring), `NOTE.md` (engineering decisions).

## Verification

`scripts/audit.mjs` exercises the requirements against a running server with real AI — latest run: **12/12 passed**.

| Check | Requirement | Evidence |
| --- | --- | --- |
| `A1-reject-type` | Reject non-PDF/DOCX clearly | HTTP 400 |
| `A1-scanned` | Refuse scanned PDFs, don't save empty | `failed` + guidance message |
| `A1-docx` / `A1-docx-text` | DOCX extraction | `ready`, 347 chars extracted |
| `A4-150pages` | 150-page contract works | `pageCount: 150`, 76,850 chars |
| `A1-library-delete` | Library list/open/delete | count decremented |
| `A2-stop-keeps-partial` | Stop keeps partial answer | `stopped`, 49 chars retained |
| `A3-absent` | Say so instead of inventing | “does not contain any provision…” |
| `C-multiround` | Real multi-round tool use | 4 steps: search → pages → search → pages |
| `C-quotes-verified` | Quotes verified on final answer | 2 verified, 0 dropped |
| `B6-multi` | Comparative answer, sourced quotes | 2 source documents cited |
| `A4-deep-retrieval` | No 30-page skim | citation from page 120 |

B5 is covered by the glyph-mapping implementation plus the `highlight.png` screenshot; B7 by the live compare run (3 material changes, substance summary distinguishing rewording from the AED 100,000 → 1,000,000 cap move).

## Deploy

- **Hosting** — Vercel Hobby (free; API routes work unchanged). Firebase Hosting is static-only and cannot run this app; Firebase App Hosting requires the Blaze plan — so Vercel hosts, Firebase remains the database.
- **Vercel env vars** — `GROQ_API_KEY`, `FIREBASE_PROJECT_ID=vellum-project`, `FIREBASE_SERVICE_KEY` (whole service-account JSON), then Redeploy.
- **Database** — Firestore Native mode, `asia-south1`, default-deny `firestore.rules` (deployed). Key-based queries cost a few hundred reads per question — inside the 50k/day free quota.
- Firebase service config lives in `firebase.json`, `firestore.rules`, `storage.rules`, `apphosting.yaml` (kept for a future Blaze rollout).

## What is finished and what is not

**Finished:** A1–A4, B5–B7, Part C Option 2 (live tool activity, round cap, malformed-call handling, quote verification), clause detection powering `list_clauses` plus a Clauses tab in the workspace, browser-side originals with Firestore text/history, free-tier deployment path.

**Extras (all working):** reversible anonymise (`[PERSON_1]`… with a per-document toggle; originals always stored), semantic search (local MiniLM embeddings cached per chunk, fused 50/50 with lexical, lexical fallback), answer export to Word with verified quotes, voice input, retry/reprocess recovery for failed or interrupted jobs, Arabic RTL content areas, and a Chats history page with search.

**Not built:** Part C Option 1 (tracked-change redlining — deliberately not chosen). Demo video is a submission artefact, recorded separately.
