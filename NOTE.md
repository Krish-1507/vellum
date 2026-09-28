# Engineering note — Vellum (Option 2: Agentic document research)

## How quote verification works, and where it could fail

The model is never trusted for positions, page numbers, or offsets. After it answers, each claimed quote is taken as a bare string and located in the stored document text (`src/lib/quotes.ts`), then mapped back through an index map to character offsets and the page spans recorded at extraction time. Only located quotes render as verified citations that open in the document; the rest are recorded as omitted and counted in the UI — never presented as genuine.

Matching is whitespace-normalised: runs of spaces, line breaks, non-breaking spaces, curly quotes, and dashes are folded, because extraction adds and removes spacing without changing words. If a full match fails, we retry punctuation-stripped, then a leading token window, then individual long sentences (for quotes the model splits with ellipses).

It can still fail when the model paraphrases so heavily that no ~12-character span survives (correctly dropped, but the answer loses support); when extraction dropped the words entirely; when near-identical clauses repeat and the first occurrence is highlighted though the model meant the fifth; or when the PDF text-layer order differs from reading order, so the on-page highlighter misses a quote that verified against extracted text.

## How large documents are handled

Files are split into ~1,400-character chunks with headings preserved (`src/lib/extract.ts`). The chat path never puts the document in the prompt: an agent loop calls `search_document` (lexical search over every chunk — a full-document search counts as coverage), `get_section`, `list_clauses`, and `get_pages` (capped at 8 pages per call). Six rounds maximum, then a forced answer from whatever was retrieved. If the model answered after only partial retrieval, the message is marked `partial` with a visible warning that absence of a clause is not certain — it must not claim a clause is absent after skimming. Verified on a 150-page file by retrieving a heading from page 120.

## Part C choice, progress, and hardest part

I chose **Option 2** because it is the same problem as large-document honesty: the model should look things up, and the product should show that work. Option 1 (tracked-change DOCX surgery — run-splitting, `w:ins`/`w:del`, numbering preservation) is a different craft, and a fake “regenerate and diff” would fail the brief, so it was deliberately not attempted.

What works: a real multi-round loop (observed 4-step runs mixing search and page reads), live status lines as calls happen, unknown/malformed tool calls returned as JSON errors, a 6-round cap with a forced final answer, and quote verification on that answer. The hardest part was keeping the final answer honest when the model wants to call tools forever or emit near-exact citations: the round cap plus the verifier are the guardrails, and the 12/12 audit (`scripts/audit.mjs`) proves the loop, the cap path, and the verifier against real contracts.

## What I would build next with more time

1. Embedding retrieval alongside the lexical search (the current search is token-overlap; embeddings would catch conceptual matches).
2. Answer export to Word with verified quotes.
3. Real DOCX tracked changes (Option 1), touching only the runs that moved.
4. A persistent processing queue so a restart mid-extract recovers cleanly.

## Production lessons kept in the code

- Windows Postgres clusters can initialise as `WIN1252`, which rejects em-dashes and curly quotes (`22P05`) — the app has since moved to Firestore, but `src/lib/pgtext.ts` still strips NULs and lone surrogates at every write site because model output and PDF extraction both produce them.
- The Groq default is `openai/gpt-oss-120b`: `llama-3.3-70b-versatile` is enterprise-only and 404s on free keys. Tool payloads are capped (~2,500 chars), output at 1,024 tokens, and 429s are retried with the provider's wait time.
- The server is stateless: originals live in browser IndexedDB, text and history in Firestore — nothing to lose on redeploy.
