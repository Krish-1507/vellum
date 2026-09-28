# Vellum

A contract desk: upload a PDF or Word file, ask questions, and get answers that only stand if the quote can be found in the document. Click a citation and the passage is highlighted on the page.

No accounts. One user. Built for the engineering assignment (Parts A, B, and C option 2).

## What it does

- **Upload & library** — PDF and `.docx` only. Other types are rejected with a clear message. Processing status is streamed while text is extracted. Scanned PDFs with no selectable text are refused instead of being saved empty.
- **Chat** — Questions stream token by token. Stop mid-answer and keep what was written. History is stored per document.
- **Verified quotes** — Every citation is searched in the extracted text with whitespace folding. Invented or paraphrased quotes are dropped, never shown as genuine.
- **Large files** — A 150-page contract is chunked. The model does not receive the whole file. It looks things up with tools. If it only read part of the file, the UI says so.
- **Citation highlighting** — Clicking a quote opens that page and paints the passage. Quotes that wrap lines, cross a page break, or appear more than once are handled.
- **Multi-document questions** — Select several files, ask once. The answer is comparative; each quote names its source and is verified against that file only.
- **Comparison** — Two versions, clause-level diffs, a plain-language summary, filter by high / medium / low significance. Rewording is not treated as a commercial change.
- **Part C: agentic research** — `search_document`, `get_section`, `list_clauses`, `get_pages`. Multi-round loop, live status (“Searching for termination provisions…”), hard cap of 6 rounds, malformed tool calls swallowed.

## Screenshots

![Library and upload](docs/screenshots/library.png)

![Chat with verified quotes](docs/screenshots/chat.png)

![Citation highlighting](docs/screenshots/highlight.png)

![Document comparison](docs/screenshots/compare.png)

## How to run locally

```bash
npm install
cp .env.example .env   # or edit .env
npx drizzle-kit push
npm run dev
```

PostgreSQL should be reachable at `DATABASE_URL`.

### Environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `AI_API_KEY` | API key (OpenAI-compatible). Also accepts `OPENAI_API_KEY` or `OPENROUTER_API_KEY` |
| `AI_BASE_URL` | Default `https://api.openai.com/v1` |
| `AI_MODEL` | Default `gpt-4o-mini` |

Do not commit keys.

## What is finished

- Parts A1–A4
- Parts B5–B7
- Part C option 2 (agentic document research), including live tool activity, round cap, and quote verification on the final answer
- Clause detection used by `list_clauses`
- Comparison significance ranking

## What is not

- Option 1 (tracked-change redlining) was not chosen
- Optional extras (anonymise, embeddings, export, Arabic UI, background job recovery, voice) are not in this build
- Demo video / deployed URL are submission artefacts, not part of this repository

## Architecture notes

See `NOTE.md` for quote verification, large-document strategy, and the Part C write-up.
