"use client";

import { useEffect, useState } from "react";
import { getLocalFile } from "@/lib/localfiles";
import { DocxViewer } from "./DocxViewer";
import { PdfViewer } from "./PdfViewer";

export function useLocalFileUrl(documentId: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!documentId) {
      setUrl(null);
      return;
    }
    let live = true;
    let objectUrl: string | null = null;
    getLocalFile(documentId).then((blob) => {
      if (!live) return;
      if (blob) {
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } else {
        setUrl(null);
      }
    });
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
  }, [documentId]);
  return url;
}

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
  const fileUrl = useLocalFileUrl(kind === "pdf" ? documentId : null);
  if (kind === "pdf") {
    if (!fileUrl) {
      return (
        <div className="flex h-full items-center justify-center p-8 text-center text-sm text-[var(--color-ink-soft)]">
          <p className="max-w-sm">
            The original file lives in the browser it was uploaded from. Re-upload it here for the
            page preview — chat and quotes work regardless.
          </p>
        </div>
      );
    }
    return <PdfViewer fileUrl={fileUrl} page={page} quote={quote} occurrence={occurrence} />;
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
