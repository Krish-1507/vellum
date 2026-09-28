# Note

## Quote verification

The model is never trusted for offsets, page numbers, or “the quote is on page 12”. After it answers, every citation is taken as a string and searched in the extracted text.

Search is whitespace-normalised: runs of space, line breaks, non-breaking spaces, and curly quotes/dashes are folded so extraction artefacts do not reject a genuine passage. If a full-string match fails we try punctuation-stripped text, a leading token window, then individual long sentences (for quotes the model split with ellipses).

A hit is mapped back through an index map to original character offsets, then to page spans stored at extraction time. Only then is the quote shown. Misses are stored as omitted and never rendered as citations; the UI mentions that something was dropped.

It can still fail when:

- The model paraphrases so heavily that no 12+ character span survives
- OCR/extraction dropped the words entirely
- Two near-identical clauses exist and we highlight the first occurrence unless the model’s wording distinguishes them
- The PDF text layer order does not match reading order, so the on-page highlighter (a second, independent search in glyph positions) misses even though the quote verified against extracted text

## Large documents

The file is split into ~1,400-character chunks with headings preserved. The chat path does not stuff the document into the prompt. An agent loop calls `search_document` (lexical scoring over every chunk), `get_section`, `list_clauses`, and `get_pages` (capped at 8 pages). A full-document search counts as coverage; paging through a slice does not. If the model answers after only partial retrieval, the message is marked partial and the UI warns that absence of a clause is not certain. Six rounds maximum, then a forced answer from whatever was retrieved.

## Part C — option 2, agentic research

I picked option 2 because it is the same problem as large-document honesty: the model should look things up, and the product should show that work. Tracked-change DOCX surgery (option 1) is a different craft — XML run splitting, `w:ins`/`w:del`, numbering — and a fake “regenerate and diff” would fail the brief.

What works: a real tool loop, status lines as calls happen, unknown/malformed tools returning JSON errors instead of crashing, quotes still verified at the end.

Hardest part: keeping the final streamed answer honest when the model wants to call tools forever or emit citations that are close but not exact. The round cap and the verifier are the guardrails; they are not perfect.

## Next with more time

- Persistent job queue so a restart mid-extract recovers
- Embedding retrieval alongside the lexical search
- Real DOCX tracked changes (option 1), touching only the runs that moved
- Export of an answer + verified quotes to Word
