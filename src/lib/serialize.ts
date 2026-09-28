import type { CiteRow, DocRow, MsgRow } from "./store";
import type { DocumentSummary, SerializedMessage } from "@/lib/types";

export function documentSummary(doc: DocRow): DocumentSummary {
  return {
    id: doc.id,
    name: doc.name,
    originalFilename: doc.originalFilename,
    mimeType: doc.mimeType,
    fileSize: doc.fileSize,
    kind: doc.kind,
    status: doc.status,
    errorMessage: doc.errorMessage,
    pageCount: doc.pageCount,
    charCount: doc.charCount,
    outline: doc.outlineJson,
    clauses: doc.clausesJson,
    hasHtml: Boolean(doc.htmlContent),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export function serializeMessage(message: MsgRow, citations: CiteRow[]): SerializedMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    status: message.status,
    coverage: message.coverage,
    coverageNote: message.coverageNote,
    activity: message.activityJson,
    createdAt: message.createdAt.toISOString(),
    citations: citations
      .filter((c) => !c.omitted)
      .map((c) => ({
        id: c.id,
        documentId: c.documentId,
        quoteText: c.displayText || c.quoteText,
        verified: c.verified,
        pageNumber: c.pageNumber,
        pageEnd: c.pageEnd,
        charStart: c.charStart,
        charEnd: c.charEnd,
        occurrence: c.occurrence,
        totalOccurrences: c.totalOccurrences,
      })),
    droppedUnverified: citations.filter((c) => c.omitted).length,
  };
}


