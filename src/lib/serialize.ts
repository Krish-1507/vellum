import type { CiteRow, DocRow, MsgRow } from "./store";
import { applyAnon } from "./anon";
import type { DocumentSummary, Entity, SerializedMessage } from "@/lib/types";

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
    anonymized: doc.anonymized,
    entityCount: doc.entitiesJson.length,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export function serializeMessage(
  message: MsgRow,
  citations: CiteRow[],
  entities: Entity[] = [],
): SerializedMessage {
  const content =
    message.role === "assistant" ? applyAnon(message.content, entities) : message.content;
  return {
    id: message.id,
    role: message.role,
    content,
    status: message.status,
    coverage: message.coverage,
    coverageNote: message.coverageNote,
    activity: message.activityJson,
    createdAt: message.createdAt.toISOString(),
    citations: citations
      .filter((c) => !c.omitted)
      .map((c) => {
        const shown = c.displayText || c.quoteText;
        const masked = applyAnon(shown, entities);
        return {
          id: c.id,
          documentId: c.documentId,
          quoteText: masked,
          // Original wording stays available for locating the passage.
          locator: masked === shown ? undefined : shown,
          verified: c.verified,
          pageNumber: c.pageNumber,
          pageEnd: c.pageEnd,
          charStart: c.charStart,
          charEnd: c.charEnd,
          occurrence: c.occurrence,
          totalOccurrences: c.totalOccurrences,
        };
      }),
    droppedUnverified: citations.filter((c) => c.omitted).length,
  };
}


