"use client";

import { DocxViewer } from "./DocxViewer";
import { PdfViewer } from "./PdfViewer";

export function DocumentViewer({
  documentId,
  kind,
  html,
  page,
  quote,
  occurrence,
}: {
  documentId: string;
  kind: string;
  html: string | null;
  page: number;
  quote: string | null;
  occurrence?: number;
}) {
  if (kind === "pdf") {
    return (
      <PdfViewer
        fileUrl={`/api/documents/${documentId}/file`}
        page={page}
        quote={quote}
        occurrence={occurrence}
      />
    );
  }
  if (html) {
    return <DocxViewer html={html} quote={quote} />;
  }
  return (
    <div className="flex h-full items-center justify-center p-8 text-sm text-[var(--color-ink-soft)]">
      No preview for this file. The extracted text is still searchable in chat.
    </div>
  );
}
