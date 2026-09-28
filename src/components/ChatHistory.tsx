"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { IconChat } from "./icons";

type HistoryItem = {
  id: string;
  title: string;
  mode: string;
  documentIds: string[];
  documentNames: string[];
  messageCount: number;
  createdAt: string;
  updatedAt: string;
};

function timeAgo(iso: string) {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function ChatHistory() {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/conversations")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Could not load chats.");
        setItems(j.conversations || []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load chats."));
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle || !items) return items;
    return items.filter(
      (c) =>
        c.title.toLowerCase().includes(needle) ||
        c.documentNames.some((n) => n.toLowerCase().includes(needle)),
    );
  }, [items, q]);

  return (
    <div className="vellum-scroll flex-1 overflow-y-auto px-5 py-10 sm:px-8 lg:py-14">
      <div className="mx-auto w-full max-w-3xl">
        <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-burgundy)]">
          History
        </p>
        <h1 className="mt-3 font-[family-name:var(--font-serif)] text-[clamp(2.2rem,4vw,3.4rem)] leading-[0.95] tracking-[-0.03em]">
          Every question, kept.
        </h1>

        <div className="mt-8 flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search chats or documents…"
            aria-label="Search chats"
            className="min-h-[2.9rem] flex-1 rounded-[4px] border border-[var(--color-rule)] bg-[var(--color-paper-2)] px-4 text-sm outline-none placeholder:text-[var(--color-ink-soft)] focus:border-[var(--color-ink)]"
          />
          <Link
            href="/ask"
            className="press flex items-center rounded-[4px] bg-[var(--color-ink)] px-5 text-sm text-[var(--color-paper)]"
          >
            New chat
          </Link>
        </div>

        {error && <p className="mt-4 text-sm text-[var(--color-burgundy)]">{error}</p>}

        <section className="mt-8">
          {filtered === null ? (
            <ul aria-label="Loading">
              {[0, 1, 2].map((i) => (
                <li key={i} className="border-t border-[var(--color-rule)] py-4">
                  <span className="skel block h-5 w-2/3 rounded-[3px]" />
                  <span className="skel mt-2 block h-3 w-1/3 rounded-[3px]" />
                </li>
              ))}
            </ul>
          ) : filtered.length === 0 ? (
            <p className="border-t border-[var(--color-rule)] py-10 text-sm text-[var(--color-ink-soft)]">
              {items?.length
                ? "No chats match that search."
                : "No chats yet. Open a document and ask something — it will be filed here."}
            </p>
          ) : (
            <ul className="divide-y divide-[var(--color-rule)] border-y border-[var(--color-rule)]">
              {filtered.map((c, i) => {
                const href =
                  c.mode === "multi"
                    ? `/ask?docs=${c.documentIds.join(",")}`
                    : `/d/${c.documentIds[0] || ""}`;
                return (
                  <li key={c.id}>
                    <Link
                      href={href}
                      className="rise group flex items-center gap-4 py-4"
                      style={{ "--i": Math.min(i, 8) } as CSSProperties}
                    >
                      <IconChat className="h-5 w-5 shrink-0 text-[var(--color-ink-soft)]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-[family-name:var(--font-serif)] text-lg leading-tight group-hover:text-[var(--color-burgundy)]">
                          {c.title}
                        </span>
                        <span className="mt-1 block font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
                          {c.mode === "multi" ? `${c.documentIds.length} files` : (c.documentNames[0] || "Document")} · {c.messageCount} messages · {timeAgo(c.updatedAt)}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
