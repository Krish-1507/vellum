# Vellum — Contract Desk

Vellum is a small web app for reading contracts the careful way. You upload a PDF or Word file, ask questions about it in plain language, and get answers that point at the exact passage they came from. Click a quote and the app opens that page with the passage highlighted. If the answer is not in the document, it says so.

**Live app:** https://vellum-fawn-xi.vercel.app/
**Repository:** https://github.com/Krish-1507/vellum (this repo)

One user, no accounts. I built it for an engineering assignment covering document chat (Part A), cross-document work and comparison (Part B), and agentic research (Part C, Option 2). Everything below is verified by an automated audit that runs the real app — see [Verification](#verification).

## What it does

**Upload and library.** Drop a PDF or `.docx` and watch it get read: upload, text extraction, page indexing, clause splitting, each step reported as it happens. Anything else (`.txt`, images, and so on) is refused with a sentence that says what to upload instead. A scanned PDF with no readable text is refused too — the app tells you to export a text-based PDF or run OCR, rather than saving an empty file and pretending it worked. The library lists every file with its size, page count, and status; files open into a reading workspace and delete cleanly.

**Chat.** Ask anything about the open document. The answer streams in as it is written, with a feed showing what the assistant is looking up (“Searching for liability cap…”) instead of a spinner. You can stop it halfway; whatever was written stays, marked as stopped. Every conversation is saved per document (or per document set) and reopens where you left off. There is also a Chats page with search across all conversations and a New Chat button.

**Verified quotes.** This is the core of the app. The model is required to attach its sources as a citations block, and then my code — not the model — locates each quote in the stored document text. Matching ignores whitespace differences (line breaks, extra spaces, curly quotes), because extraction always mangles those. A quote that is found is shown as verified with its page number and opens in the document on click. A quote that cannot be found is dropped and counted on screen (“2 citations could not be found…”), never dressed up as genuine. Each quote is checked against its own document only.

**Large documents.** A 150-page contract works. The file is cut into overlapping chunks and the model never sees the whole thing; it searches, opens sections, and reads page ranges through tools. The honest part: if the model only retrieved part of the file before answering, the answer is flagged as partial with a warning that a missing clause may simply be unread. I proved this by pulling a heading off page 120 of a generated 150-page file.

**Citation highlighting.** Quote chips jump to the right page, scroll to the passage, and paint it. For PDFs the mapping is done at glyph level (the rendered page and the extracted text are laid out differently, so this took real work); for Word exports it wraps the text range. Quotes spanning lines, crossing page breaks, or appearing several times are handled.

**Ask across files.** Select several documents and ask one question. You get a single comparative answer, and every quote names the file it came from.

**Comparison.** Upload two drafts of the same contract and get clause-level differences — added, removed, rewritten — each scored high/medium/low by substance. A reworded sentence scores low; a liability cap moving from AED 100,000 to AED 1,000,000 scores high. A short summary explains what changed in plain language, and you can filter by significance.

**Agentic research (Part C, Option 2).** I picked the research option over tracked-change redlining (explained in `NOTE.md`). The model gets four tools — `search_document`, `get_section`, `list_clauses`, `get_pages` — and decides for itself what to look up, over up to six rounds, with malformed calls handled as errors rather than crashes. Quote verification applies to the final answer exactly as usual.

**Extras, all working:** reversible anonymisation (`[PERSON_1]` and friends, per-document toggle, originals always kept), semantic search (local embeddings cached per chunk, blended with keyword search, keyword fallback), answer export to Word with its verified quotes, voice input, retry for failed or interrupted processing, Arabic right-to-left content areas, and a clause browser tab per document.

## Screenshots

Library and upload:

![Library and upload](docs/screenshots/library.png)

Chat with verified quotes:

![Chat with verified quotes](docs/screenshots/chat.png)

Citation highlighting (click a quote, the passage lights up on the page):

![Citation highlighting](docs/screenshots/highlight.png)

Document comparison:

![Document comparison](docs/screenshots/compare.png)

## How to run it locally

You need Node 22+, npm, and Java 17+ (only for the local database emulator).

```bash
npm install
cp .env.example .env   # then add your GROQ_API_KEY (free at console.groq.com)
npm run db:emulator     # terminal 1 — local Firestore on :8080
npm run dev             # terminal 2 — http://localhost:3000
```

That is the whole setup. There is no Postgres, no Docker, no migration step. Structured data lives in Firestore (the emulator locally, the `vellum-project` database in production); the original files stay in your browser's IndexedDB, so the server keeps nothing on disk and there is nothing to lose on redeploy.

To try every feature in a few minutes:

```bash
node scripts/make-sample-pdf.mjs   # two contract drafts for chat and comparison
node scripts/make-audit-files.mjs  # a blank PDF, a 150-page PDF, a .docx, a names fixture
node scripts/audit.mjs             # 12 checks against the running app (needs GROQ_API_KEY)
node scripts/verify-extras.mjs     # 7 checks for the extras
```

Configuration is five variables, all documented in `.env.example`: `GROQ_API_KEY` (the model default is `openai/gpt-oss-120b` — 131k context, tool use, cents per session), optional `AI_*` overrides for any other OpenAI-compatible provider, and `FIREBASE_PROJECT_ID` / `FIRESTORE_EMULATOR_HOST` / `FIREBASE_SERVICE_KEY` for the database. `.env` is gitignored and no key has ever been committed — I checked the history.

## Verification

`scripts/audit.mjs` tests the assignment requirements against the running app with the real model. The last full run passed **12/12**:

- Wrong file types rejected (HTTP 400), scanned PDF refused with guidance, DOCX extracts, 150 pages index (76,850 chars), library delete works.
- Stopping mid-answer keeps the partial text (`stopped`); an unanswerable question gets an honest “the agreement does not contain…” instead of an invention.
- A two-part question took 4 tool rounds (search → read pages → search → read pages) and ended with 2 verified quotes, 0 dropped.
- A cross-file question cited both sources comparatively; a page-120 heading was retrieved from the 150-pager.

`scripts/verify-extras.mjs` passed **7/7** (export downloads a valid `.docx`, anonymisation masks and reverses, failed jobs recover, history page and search respond). I also ran the same upload → chat → verified-quote flow against the production link and cleaned up afterwards.

## Deploy

The live app runs on Vercel's free tier (API routes work unchanged there). Firebase Hosting is static-only so it cannot host this app, and Firebase App Hosting needs a paid plan — Vercel hosts, Firebase remains the database, which keeps the whole thing free. Production needs three Vercel variables (`GROQ_API_KEY`, `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_KEY` holding a service-account JSON), then a redeploy. Firebase-side config in the repo: `firebase.json`, `firestore.rules`, `storage.rules`, `apphosting.yaml`.

## What is finished and what is not

Finished: A1–A4, B5–B7, Part C Option 2, and the extras listed above (anonymise, semantic search, Word export, voice, recovery, Arabic RTL, clause browser, chat history). Each one is covered by the audits, not just present in the UI.

Not attempted: Part C Option 1 (tracked-change redlining) — a deliberate choice, explained in `NOTE.md`. The demo video is recorded separately and linked at submission.
