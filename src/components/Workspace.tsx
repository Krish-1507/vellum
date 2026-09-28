"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { DocumentSummary } from "@/lib/types";
import { ChatPane, type FocusCite } from "./ChatPane";
import { DocumentViewer } from "./DocumentViewer";

type DocDetail = DocumentSummary & { htmlContent: string | null };

export function Workspace({ documentId }: { documentId: string }) {
  const [doc, setDoc] = useState<DocDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [focus, setFocus] = useState<FocusCite | null>(null);
  const [tab, setTab] = useState<"chat" | "page">("chat");

  useEffect(() => {
    fetch(`/api/documents/${documentId}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error || "Not found");
        setDoc(json.document);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Not found"));
  }, [documentId]);

  if (error) {
    return (
      <div className="px-8 py-16">
        <p className="font-[family-name:var(--font-serif)] text-3xl">This file is not on the shelf.</p>
        <Link href="/" className="mt-4 inline-block text-sm text-[var(--color-burgundy)]">
          Back to the library
        </Link>
      </div>
    );
  }

  if (!doc) {
    return <div className="px-8 py-16 text-sm text-[var(--color-ink-soft)]">Opening the file…</div>;
  }

  if (doc.status !== "ready") {
    return (
      <div className="px-8 py-16">
        <p className="font-[family-name:var(--font-serif)] text-3xl">
          {doc.status === "failed" ? "This file could not be read." : "Still extracting…"}
        </p>
        <p className="mt-3 max-w-lg text-sm text-[var(--color-ink-soft)]">
          {doc.errorMessage || "Go back to the library. Processing status is shown there while the text is taken off the page."}
        </p>
        <Link href="/" className="mt-4 inline-block text-sm text-[var(--color-burgundy)]">
          Back to the library
        </Link>
      </div>
    );
  }

  function onFocus(cite: FocusCite) {
    setFocus(cite);
    setTab("page");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-[var(--color-rule)] px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <p className="font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-soft)]">
            {doc.kind} · {doc.pageCount} pages
          </p>
          <h1 className="truncate font-[family-name:var(--font-serif)] text-xl leading-tight">{doc.name}</h1>
        </div>
        <div className="flex rounded-[4px] border border-[var(--color-rule)] lg:hidden">
          <button
            type="button"
            onClick={() => setTab("chat")}
            className={`px-3 py-1.5 text-xs ${tab === "chat" ? "bg-[var(--color-ink)] text-[var(--color-paper)]" : ""}`}
          >
            Chat
          </button>
          <button
            type="button"
            onClick={() => setTab("page")}
            className={`px-3 py-1.5 text-xs ${tab === "page" ? "bg-[var(--color-ink)] text-[var(--color-paper)]" : ""}`}
          >
            Page
          </button>
        </div>
      </header>
      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <section className={`min-h-0 border-r border-[var(--color-rule)] ${tab === "chat" ? "block" : "hidden lg:block"}`}>
          <ChatPane
            documentIds={[doc.id]}
            documentNames={{ [doc.id]: doc.name }}
            conversationId={conversationId}
            onConversation={setConversationId}
            onFocusCite={onFocus}
          />
        </section>
        <section className={`min-h-0 ${tab === "page" ? "block" : "hidden lg:block"}`}>
          <DocumentViewer
            documentId={doc.id}
            kind={doc.kind}
            html={doc.htmlContent}
            page={focus?.pageNumber || 1}
            quote={focus?.quote || null}
            occurrence={focus?.occurrence || 0}
          />
        </section>
      </div>
    </div>
  );
}
