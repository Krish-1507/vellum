// Extraction pipeline. Stateless: the file bytes arrive with the upload
// request (the server keeps no copy — originals live in the browser's
// IndexedDB). Text, pages, chunks, outline and clauses go to Firestore.
import {
  getDocument,
  replaceChunks,
  replacePages,
  setDocumentText,
  updateDocument,
} from "./store";
import { extractDocx, extractPdf, ScannedPdfError, EmptyDocumentError } from "./extract";

export async function processDocument(
  id: string,
  buffer: Buffer,
  kind: string,
  onProgress?: (message: string) => void,
) {
  const doc = await getDocument(id);
  if (!doc) throw new Error("Document not found");

  await updateDocument(id, { status: "processing", errorMessage: null });
  onProgress?.(kind === "pdf" ? "Extracting text from each page…" : "Reading the Word document…");

  try {
    const extracted = kind === "pdf" ? await extractPdf(buffer) : await extractDocx(buffer);

    onProgress?.(`Indexed ${extracted.pageCount} page${extracted.pageCount === 1 ? "" : "s"} · splitting clauses…`);

    await replacePages(
      id,
      extracted.pages.map((p) => ({
        documentId: id,
        pageNumber: p.pageNumber,
        text: p.text,
        charStart: p.charStart,
        charEnd: p.charEnd,
      })),
    );
    await replaceChunks(
      id,
      extracted.chunks.map((c) => ({
        documentId: id,
        chunkIndex: c.chunkIndex,
        heading: c.heading,
        text: c.text,
        pageStart: c.pageStart,
        pageEnd: c.pageEnd,
        charStart: c.charStart,
        charEnd: c.charEnd,
      })),
    );
    await setDocumentText(id, extracted.text, extracted.html, {
      status: "ready",
      pageCount: extracted.pageCount,
      charCount: extracted.charCount,
      outline: extracted.outline,
      clauses: extracted.clauses,
    });

    onProgress?.("Ready.");
    return { ok: true as const, pageCount: extracted.pageCount };
  } catch (err) {
    const message =
      err instanceof ScannedPdfError || err instanceof EmptyDocumentError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Could not read this file.";
    await updateDocument(id, { status: "failed", errorMessage: message });
    onProgress?.(message);
    return { ok: false as const, message };
  }
}

// Deleting a server copy is a no-op (there is none); kept so callers don't
// need to know where bytes live. Browser copies are cleared client-side.
export async function removeStoredFile(_storagePath: string | null) {}
