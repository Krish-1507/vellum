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
  const [leftTab, setLeftTab] = useState<"ask" | "clauses">("ask");

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

  async function toggleAnon() {
    if (!doc) return;
    const res = await fetch(`/api/documents/${doc.id}/anonymize`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anonymized: !doc.anonymized }),
    });
    const json = await res.json();
    if (json.document) {
      setDoc((d) => (d ? { ...d, anonymized: json.document.anonymized } : d));
    }
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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void toggleAnon()}
            title={doc.anonymized ? "Show original names" : "Mask names and companies"}
            className={`press rounded-[4px] border px-3 py-1.5 font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.16em] ${
              doc.anonymized
                ? "border-[var(--color-burgundy)] bg-[var(--color-burgundy)] text-[var(--color-paper-2)]"
                : "border-[var(--color-rule)] text-[var(--color-ink-soft)]"
            }`}
          >
            {doc.anonymized ? "Masked" : "Mask names"}
          </button>
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
        </div>
      </header>
      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <section className={`min-h-0 border-r border-[var(--color-rule)] ${tab === "chat" ? "block" : "hidden lg:block"}`}>
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex gap-1 border-b border-[var(--color-rule)] px-4 pt-3 sm:px-6">
              {(["ask", "clauses"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setLeftTab(t)}
                  className={`rounded-t-[4px] px-3 py-1.5 font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.16em] ${
                    leftTab === t
                      ? "bg-[var(--color-ink)] text-[var(--color-paper)]"
                      : "text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
                  }`}
                >
                  {t === "ask" ? "Ask" : `Clauses · ${doc.clauses.length}`}
                </button>
              ))}
            </div>
            {leftTab === "ask" ? (
              <div className="min-h-0 flex-1">
                <ChatPane
                  documentIds={[doc.id]}
                  documentNames={{ [doc.id]: doc.name }}
                  conversationId={conversationId}
                  onConversation={setConversationId}
                  onFocusCite={onFocus}
                />
              </div>
            ) : (
              <div className="vellum-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
                {doc.clauses.length === 0 ? (
                  <p className="py-6 text-sm text-[var(--color-ink-soft)]">
                    No standard clauses detected in this file.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {doc.clauses.map((c, i) => (
                      <li key={`${c.kind}-${i}`}>
                        <button
                          type="button"
                          onClick={() =>
                            onFocus({
                              documentId: doc.id,
                              quote: c.excerpt,
                              pageNumber: c.page,
                              occurrence: 0,
                            })
                          }
                          className="press w-full rounded-[4px] border border-[var(--color-rule)] bg-[var(--color-paper-2)] px-3 py-3 text-left hover:border-[var(--color-burgundy)]"
                        >
                          <span className="flex items-center justify-between gap-3">
                            <span className="font-[family-name:var(--font-serif)] text-[15px]">{c.label}</span>
                            <span className="font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.16em] text-[var(--color-ink-soft)]">
                              p.{c.page}
                            </span>
                          </span>
                          <span dir="auto" className="mt-1 block text-[13px] leading-relaxed text-[var(--color-ink-soft)]">
                            {c.excerpt}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
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
