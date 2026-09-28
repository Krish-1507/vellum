"use client";

import { useEffect, useMemo, useState } from "react";
import type { DocumentSummary } from "@/lib/types";
import type { ComparisonChange } from "@/lib/types";

type Filter = "all" | "high" | "medium" | "low";

const TYPE_LABEL: Record<string, string> = {
  added: "Added",
  removed: "Removed",
  modified: "Changed",
  reworded: "Reworded",
};

export function CompareDesk() {
  const [docs, setDocs] = useState<DocumentSummary[]>([]);
  const [leftId, setLeftId] = useState("");
  const [rightId, setRightId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [changes, setChanges] = useState<ComparisonChange[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [leftName, setLeftName] = useState("Original");
  const [rightName, setRightName] = useState("Revised");

  useEffect(() => {
    fetch("/api/documents")
      .then((r) => r.json())
      .then((j) => {
        const ready = ((j.documents || []) as DocumentSummary[]).filter((d) => d.status === "ready");
        setDocs(ready);
        if (ready[0]) setLeftId(ready[0].id);
        if (ready[1]) setRightId(ready[1].id);
      })
      .catch(() => setError("Could not load documents."));
  }, []);

  const visible = useMemo(() => {
    const list = filter === "all" ? changes : changes.filter((c) => c.significance === filter);
    return [...list].sort((a, b) => b.significanceScore - a.significanceScore);
  }, [changes, filter]);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leftId, rightId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Compare failed.");
      setSummary(json.comparison.summary);
      setChanges(json.comparison.changes || []);
      setLeftName(json.comparison.left.name);
      setRightName(json.comparison.right.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Compare failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="vellum-scroll flex-1 overflow-y-auto px-5 py-8 sm:px-8 lg:px-12 lg:py-10">
      <header className="max-w-3xl">
        <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-burgundy)]">
          Two versions
        </p>
        <h1 className="mt-3 font-[family-name:var(--font-serif)] text-[clamp(2.2rem,4vw,3.6rem)] leading-[0.95] tracking-[-0.03em]">
          What actually moved.
        </h1>
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-[var(--color-ink-soft)]">
          Clause-level, not a character diff. A tidy sentence is not the same as a liability cap jumping a zero.
        </p>
      </header>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="block flex-1 text-xs uppercase tracking-[0.14em] text-[var(--color-ink-soft)]">
          Original
          <select
            value={leftId}
            onChange={(e) => setLeftId(e.target.value)}
            className="mt-1 w-full rounded-[4px] border border-[var(--color-rule)] bg-[var(--color-paper-2)] px-3 py-2 text-sm text-[var(--color-ink)]"
          >
            {docs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block flex-1 text-xs uppercase tracking-[0.14em] text-[var(--color-ink-soft)]">
          Revised
          <select
            value={rightId}
            onChange={(e) => setRightId(e.target.value)}
            className="mt-1 w-full rounded-[4px] border border-[var(--color-rule)] bg-[var(--color-paper-2)] px-3 py-2 text-sm text-[var(--color-ink)]"
          >
            {docs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={busy || !leftId || !rightId}
          onClick={() => void run()}
          className="press rounded-[4px] bg-[var(--color-ink)] px-5 py-2.5 text-sm text-[var(--color-paper)] disabled:opacity-40"
        >
          {busy ? "Reading both…" : "Compare"}
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-[var(--color-burgundy)]">{error}</p>}

      {busy && changes.length === 0 && (
        <div className="mt-10 max-w-4xl space-y-4" aria-label="Comparing">
          <span className="skel block h-28 rounded-[4px]" />
          <span className="skel block h-40 rounded-[4px]" />
          <span className="skel block h-32 rounded-[4px]" />
        </div>
      )}

      {summary && (
        <section className="sheet mt-10 max-w-3xl px-6 py-6 sm:px-8">
          <h2 className="font-[family-name:var(--font-serif)] text-2xl">In substance</h2>
          <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed">{summary}</p>
        </section>
      )}

      {changes.length > 0 && (
        <section className="mt-10 max-w-4xl">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {(["all", "high", "medium", "low"] as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`press rounded-[4px] px-3 py-1 text-xs uppercase tracking-[0.14em] ${
                  filter === f ? "bg-[var(--color-ink)] text-[var(--color-paper)]" : "border border-[var(--color-rule)]"
                }`}
              >
                {f}
              </button>
            ))}
            <span className="ml-auto font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-ink-soft)]">
              {visible.length} shown
            </span>
          </div>
          <ul className="space-y-4">
            {visible.map((c) => (
              <li key={c.id} className="border border-[var(--color-rule)] bg-[var(--color-paper-2)] p-4 sm:p-5">
                <div className="flex flex-wrap items-baseline gap-3">
                  <span
                    className={`font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.16em] ${
                      c.significance === "high"
                        ? "text-[var(--color-burgundy)]"
                        : c.significance === "medium"
                          ? "text-[var(--color-ochre)]"
                          : "text-[var(--color-ink-soft)]"
                    }`}
                  >
                    {c.significance} · {TYPE_LABEL[c.changeType] || c.changeType}
                  </span>
                  <h3 className="font-[family-name:var(--font-serif)] text-lg leading-tight">{c.title}</h3>
                </div>
                <p className="mt-2 text-sm text-[var(--color-ink-soft)]">{c.explanation}</p>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <blockquote className="border-l-2 border-[var(--color-burgundy)] pl-3 text-[13px] leading-relaxed">
                    <span className="block font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-soft)]">
                      {leftName}
                      {c.leftPage ? ` · p.${c.leftPage}` : ""}
                    </span>
                    <span className="mt-1 block whitespace-pre-wrap">{c.leftText || "—"}</span>
                  </blockquote>
                  <blockquote className="border-l-2 border-[var(--color-forest)] pl-3 text-[13px] leading-relaxed">
                    <span className="block font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-soft)]">
                      {rightName}
                      {c.rightPage ? ` · p.${c.rightPage}` : ""}
                    </span>
                    <span className="mt-1 block whitespace-pre-wrap">{c.rightText || "—"}</span>
                  </blockquote>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
