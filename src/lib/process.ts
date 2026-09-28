import { eq } from "drizzle-orm";
import { db } from "@/db";
import { documentChunks, documentPages, documents } from "@/db/schema";
import { extractDocx, extractPdf, ScannedPdfError, EmptyDocumentError } from "./extract";
import { cleanPgText } from "./pgtext";
import { readStoredFile, removeStoredFile as removeStoredObject } from "./storage";

export async function processDocument(id: string, onProgress?: (message: string) => void) {
  const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!doc) throw new Error("Document not found");

  await db
    .update(documents)
    .set({ status: "processing", errorMessage: null, updatedAt: new Date() })
    .where(eq(documents.id, id));

  onProgress?.("Opening the file…");
  const buffer = await readStoredFile(doc.storagePath);

  onProgress?.(doc.kind === "pdf" ? "Extracting text from each page…" : "Reading the Word document…");

  try {
    const extracted = doc.kind === "pdf" ? await extractPdf(buffer) : await extractDocx(buffer);

    onProgress?.(`Indexed ${extracted.pageCount} page${extracted.pageCount === 1 ? "" : "s"} · splitting clauses…`);

    await db.delete(documentPages).where(eq(documentPages.documentId, id));
    await db.delete(documentChunks).where(eq(documentChunks.documentId, id));

    if (extracted.pages.length) {
      await db.insert(documentPages).values(
        extracted.pages.map((p) => ({
          documentId: id,
          pageNumber: p.pageNumber,
          text: cleanPgText(p.text),
          charStart: p.charStart,
          charEnd: p.charEnd,
        })),
      );
    }
    if (extracted.chunks.length) {
      await db.insert(documentChunks).values(
        extracted.chunks.map((c) => ({
          documentId: id,
          chunkIndex: c.chunkIndex,
          heading: c.heading ? cleanPgText(c.heading) : c.heading,
          text: cleanPgText(c.text),
          pageStart: c.pageStart,
          pageEnd: c.pageEnd,
          charStart: c.charStart,
          charEnd: c.charEnd,
        })),
      );
    }

    await db
      .update(documents)
      .set({
        status: "ready",
        extractedText: cleanPgText(extracted.text),
        htmlContent: extracted.html ? cleanPgText(extracted.html) : extracted.html,
        pageCount: extracted.pageCount,
        charCount: extracted.charCount,
        outlineJson: extracted.outline,
        clausesJson: extracted.clauses,
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, id));

    onProgress?.("Ready.");
    return { ok: true as const, pageCount: extracted.pageCount };
  } catch (err) {
    const message =
      err instanceof ScannedPdfError || err instanceof EmptyDocumentError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Could not read this file.";
    await db
      .update(documents)
      .set({ status: "failed", errorMessage: cleanPgText(message), updatedAt: new Date() })
      .where(eq(documents.id, id));
    onProgress?.(message);
    return { ok: false as const, message };
  }
}

export async function removeStoredFile(storagePath: string) {
  await removeStoredObject(storagePath);
}
