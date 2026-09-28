# Engineering note — Vellum

## How quote verification works, and where it could fail

The model does not get a vote on where its quotes are. It must attach a citations block to its answer, and then my code takes each claimed quote as a plain string and searches the stored document text for it (`src/lib/quotes.ts`). A hit is mapped back through an index map to character offsets, then to the page spans recorded when the file was extracted. Only then does the quote render as a verified citation with a page number that opens in the document. Anything not found is dropped and counted on screen — never shown as if it were real.

Exact string matching would be wrong here, because text extraction always disturbs spacing: line breaks move, spaces multiply, quotes turn curly. So both sides are normalised first (whitespace runs, non-breaking spaces, curly quotes and dashes folded to one form), with three fallbacks if that fails: punctuation-stripped matching, a leading token window, and per-sentence matching for quotes the model joined with ellipses.

Where it can still fail: if the model paraphrases so freely that no twelve-character stretch survives, the quote is correctly dropped but the answer loses a leg to stand on. Near-identical clauses in different places can highlight the first occurrence when the model meant the fifth. And if a PDF's text layer runs in a different order than its reading order, the on-page highlight can miss a quote that verified fine against the extracted text. I would fix the repeat-occurrence case next by letting the model disambiguate with surrounding words.

## How I handled large documents

A 150-page contract cannot go into one request, so it never does. Files are cut into overlapping chunks of about 1,400 characters with their headings kept (`src/lib/extract.ts`), and the chat path gives the model tools instead of text: `search_document` over every chunk, `get_section`, `list_clauses`, `get_pages`. The one rule I took seriously is the honesty rule — a full-document search counts as having looked everywhere, but paging through a slice does not. If the model answers after partial retrieval, the message is marked partial with a warning that a missing clause may just be unread, rather than confidently declaring it absent. I verified this end to end by retrieving a heading from page 120 of a generated 150-page file, and by asking about something that is not in the document and getting an honest refusal instead of an invention.

## Part C: why Option 2, how far it went, hardest part

I chose agentic document research because it is the same problem as large-document honesty — the model should look things up, and the interface should show that work happening. Tracked-change redlining is genuinely a different craft (splitting formatted runs, `w:ins`/`w:del`, keeping numbering intact), and anything short of the real thing — regenerating the file and diffing it — would fail the brief while looking like it passed. I would rather submit an honest partial attempt than that.

What works: a real loop, up to six rounds, where the model calls tools, reads the results, and calls more. I have watched it search, open the pages it found, search again with better terms, and then answer. Each call is narrated live (“Searching for termination provisions…”). Unknown tools, missing arguments, and malformed JSON come back as tool errors the model can recover from. Quote verification runs on the final answer exactly as in single-document mode, and the audit proves the loop, the round cap path, and the verifier against real contracts.

The hardest part was the model's instinct to answer from the first vaguely relevant passage. Two guardrails handle it: the system prompt forbids absence claims without full-document search, and the coverage flag forces the partial warning when retrieval fell short. They are heuristics, not proofs — a sufficiently confident model can still overstate — but combined with verification of every quote, the failure mode degrades to “thin answer” rather than “invented answer.”

## What I would build next with more time

First, embeddings already exist (local MiniLM vectors cached per chunk, blended with keyword search), but I would add a proper evaluation set that scores retrieval quality per question type instead of trusting my handful of test questions. Second, real DOCX tracked changes — Option 1 done properly, touching only the runs that moved. Third, a persistent processing queue so an interrupted extraction resumes instead of needing its Retry button. Fourth, answer export already covers Word; I would add PDF export to match.
