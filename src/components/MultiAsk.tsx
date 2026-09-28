"use client";

import { useEffect, useState } from "react";
import type { DocumentSummary } from "@/lib/types";
import { ChatPane, type FocusCite } from "./ChatPane";
import { DocumentViewer } from "./DocumentViewer";

type DocDetail = DocumentSummary & { htmlContent: string | null };

export function MultiAsk() {
  const [docs, setDocs] = useState<DocumentSummary[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [focus, setFocus] = useState<FocusCite | null>(null);
  const [preview, setPreview] = useState<DocDetail | null>(null);

  useEffect(() => {
    fetch("/api/documents")
      .then((r) => r.json())
      .then((j) => {
        const ready = ((j.documents || []) as DocumentSummary[]).filter((d) => d.status === "ready");
        setDocs(ready);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!focus) return;
    fetch(`/api/documents/${focus.documentId}`)
      .then((r) => r.json())
      .then((j) => setPreview(j.document))
      .catch(() => undefined);
  }, [focus?.documentId]);

  const names = Object.fromEntries(docs.map((d) => [d.id, d.name]));

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    setConversationId(null);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-[var(--color-rule)] px-5 py-4 sm:px-8">
        <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-burgundy)]">
          Several files, one question
        </p>
        <h1 className="mt-1 font-[family-name:var(--font-serif)] text-3xl leading-none">Read them together.</h1>
        <div className="mt-4 flex flex-wrap gap-2">
          {docs.map((d) => {
            const on = selected.includes(d.id);
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => toggle(d.id)}
                className={`rounded-[4px] px-3 py-1.5 text-sm ${
                  on
                    ? "bg-[var(--color-ink)] text-[var(--color-paper)]"
                    : "border border-[var(--color-rule)] text-[var(--color-ink-soft)]"
                }`}
              >
                {d.name}
              </button>
            );
          })}
          {docs.length === 0 && (
            <p className="text-sm text-[var(--color-ink-soft)]">Upload at least two ready documents first.</p>
          )}
        </div>
      </header>
      {selected.length < 2 ? (
        <p className="px-8 py-12 font-[family-name:var(--font-serif)] text-xl text-[var(--color-ink-soft)]">
          Select two or more files. The answer should compare, not list them in isolation — and each quote names its source.
        </p>
      ) : (
        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
          <section className="min-h-0 border-r border-[var(--color-rule)]">
            <ChatPane
              documentIds={selected}
              documentNames={names}
              conversationId={conversationId}
              onConversation={setConversationId}
              onFocusCite={setFocus}
            />
          </section>
          <section className="min-h-0">
            {preview ? (
              <DocumentViewer
                documentId={preview.id}
                kind={preview.kind}
                html={preview.htmlContent}
                page={focus?.pageNumber || 1}
                quote={focus?.quote || null}
                occurrence={focus?.occurrence || 0}
              />
            ) : (
              <div className="flex h-full items-center justify-center px-8 text-sm text-[var(--color-ink-soft)]">
                Click a verified quote to open that passage in its own document.
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
