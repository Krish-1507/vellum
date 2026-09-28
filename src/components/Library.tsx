"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { DocumentSummary } from "@/lib/types";
import { readSse } from "@/lib/sse";
import { deleteLocalFile, getLocalFile, saveLocalFile } from "@/lib/localfiles";
import { IconAlert, IconFile, IconTrash, IconUpload } from "./icons";

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function statusLabel(doc: DocumentSummary) {
  if (doc.status === "ready") return `${doc.pageCount} p.`;
  if (doc.status === "processing") return "Reading…";
  if (doc.status === "queued") return "Queued";
  if (doc.status === "failed") return "Failed";
  return doc.status;
}

export function Library() {
  const [docs, setDocs] = useState<DocumentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/documents");
    const json = (await res.json()) as { documents: DocumentSummary[] };
    setDocs(json.documents || []);
  }, []);

  useEffect(() => {
    load().catch(() => setError("Could not load the library."));
  }, [load]);

  const processFile = useCallback(
    async (file: File) => {
      setError(null);
      const lower = file.name.toLowerCase();
      if (!lower.endsWith(".pdf") && !lower.endsWith(".docx")) {
        setError("That file type is not supported. Upload a PDF (.pdf) or a Word document (.docx).");
        return;
      }
      setBusyName(file.name);
      setProgress("Uploading…");
      try {
        const form = new FormData();
        form.append("file", file);
        // One request: the server streams extraction progress back, stores
        // the text in Firestore, and keeps no copy. The original stays here,
        // in this browser, for the page preview.
        const res = await fetch("/api/documents", { method: "POST", body: form });
        if (!res.ok && !res.body) {
          const err = await res.json().catch(() => ({ error: "Upload failed." }));
          throw new Error((err as { error?: string }).error || "Upload failed.");
        }
        let doneDoc: DocumentSummary | null = null;
        let failMsg: string | null = null;
        await readSse(res, {
          onEvent: (event, data) => {
            const payload = data as { message?: string; document?: DocumentSummary };
            if (event === "status" && payload.message) setProgress(payload.message);
            if (event === "done" && payload.document) doneDoc = payload.document;
            if (event === "error") failMsg = payload.message || "Processing failed.";
          },
        });
        const outcome = () => ({
          doc: doneDoc as DocumentSummary | null,
          fail: failMsg as string | null,
        });
        const failed = outcome().fail;
        const finished = outcome().doc;
        if (failed) throw new Error(failed);
        if (finished) {
          await saveLocalFile(finished.id, file, file.name, file.type);
          setDocs((prev) => [finished, ...(prev || []).filter((d) => d.id !== finished.id)]);
        }
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed.");
        await load();
      } finally {
        setBusyName(null);
        setProgress(null);
      }
    },
    [load],
  );

  async function onRetry(doc: DocumentSummary) {
    setError(null);
    const blob = await getLocalFile(doc.id);
    if (!blob) {
      setError("The original is not in this browser. Upload the file again to retry.");
      return;
    }
    setBusyName(doc.originalFilename);
    setProgress("Retrying extraction…");
    try {
      const form = new FormData();
      form.append("file", blob, doc.originalFilename);
      const res = await fetch(`/api/documents/${doc.id}/reprocess`, { method: "POST", body: form });
      let failMsg: string | null = null;
      await readSse(res, {
        onEvent: (event, data) => {
          const payload = data as { message?: string };
          if (event === "status" && payload.message) setProgress(payload.message);
          if (event === "error") failMsg = payload.message || "Processing failed.";
        },
      });
      const failed = failMsg as string | null;
      if (failed) throw new Error(failed);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry failed.");
      await load();
    } finally {
      setBusyName(null);
      setProgress(null);
    }
  }

  async function onDelete(id: string) {
    const prev = docs;
    setDocs((d) => (d || []).filter((x) => x.id !== id));
    await deleteLocalFile(id);
    const res = await fetch(`/api/documents/${id}`, { method: "DELETE" });
    if (!res.ok) setDocs(prev);
  }

  const ready = useMemo(() => (docs || []).filter((d) => d.status === "ready").length, [docs]);

  return (
    <div className="vellum-scroll flex-1 overflow-y-auto px-5 py-10 sm:px-8 lg:py-14">
      <div className="mx-auto w-full max-w-3xl">
      <header>
        <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-burgundy)]">
          Reading room
        </p>
        <h1 className="mt-3 font-[family-name:var(--font-serif)] text-[clamp(2.4rem,5vw,4.2rem)] leading-[0.95] tracking-[-0.03em]">
          Bring the contract.
          <span className="italic text-[var(--color-burgundy)]"> Cite the line.</span>
        </h1>
        <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-[var(--color-ink-soft)]">
          PDF or Word. We extract the words, keep every page, and refuse to answer from thin air.
          {ready ? ` ${ready} file${ready === 1 ? "" : "s"} ready.` : ""}
        </p>
      </header>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) void processFile(file);
        }}
        className={`press mt-10 w-full max-w-3xl rounded-[6px] border border-dashed px-6 py-10 text-left transition-colors duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          dragging
            ? "border-[var(--color-burgundy)] bg-[color-mix(in_srgb,var(--color-burgundy)_8%,var(--color-paper-2))]"
            : "border-[var(--color-rule)] bg-[color-mix(in_srgb,var(--color-paper-2)_80%,white)] hover:border-[var(--color-ink-soft)]"
        }`}
      >
        <span className="flex items-start gap-4">
          <span className="mt-1 flex h-10 w-10 items-center justify-center rounded-[4px] bg-[var(--color-ink)] text-[var(--color-paper)]">
            <IconUpload className="h-5 w-5" />
          </span>
          <span>
            <span className="block font-[family-name:var(--font-serif)] text-2xl leading-none">Drop a contract</span>
            <span className="mt-3 block text-sm text-[var(--color-ink-soft)]">
              PDF and .docx only. Scanned pages without OCR will be rejected — not saved as an empty file.
            </span>
            {busyName && (
              <span className="mt-4 block">
                <span className="block font-[family-name:var(--font-mono)] text-xs tracking-wide text-[var(--color-burgundy)]">
                  {busyName} · {progress || "Working…"}
                </span>
                <span className="skel mt-2 block h-1.5 w-full rounded-full" aria-hidden="true" />
              </span>
            )}
          </span>
        </span>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void processFile(file);
            e.target.value = "";
          }}
        />
      </button>

      {error && (
        <p className="mt-5 flex max-w-3xl items-start gap-2 text-sm text-[var(--color-burgundy)]">
          <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      <section className="mt-12">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="font-[family-name:var(--font-serif)] text-xl">The shelf</h2>
          <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.16em] text-[var(--color-ink-soft)]">
            {(docs || []).length} filed
          </p>
        </div>
        {docs === null ? (
          <ul className="border-y border-[var(--color-rule)]" aria-label="Loading">
            {[0, 1, 2].map((i) => (
              <li key={i} className="flex items-center gap-4 py-4">
                <span className="skel h-5 w-5 rounded-[3px]" />
                <span className="flex-1">
                  <span className="skel block h-5 w-2/3 rounded-[3px]" />
                  <span className="skel mt-2 block h-3 w-1/3 rounded-[3px]" />
                </span>
              </li>
            ))}
          </ul>
        ) : docs.length === 0 ? (
          <p className="border-t border-[var(--color-rule)] py-10 text-sm text-[var(--color-ink-soft)]">
            Nothing on the desk yet. A 150-page agreement is fine; we index it in pieces and search the whole thing.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-rule)] border-y border-[var(--color-rule)]">
            {docs.map((doc, i) => (
              <li
                key={doc.id}
                className="rise group flex items-center gap-4 py-4"
                style={{ "--i": Math.min(i, 8) } as CSSProperties}
              >
                <IconFile className="h-5 w-5 shrink-0 text-[var(--color-ink-soft)]" />
                <div className="min-w-0 flex-1">
                  <Link
                    href={doc.status === "ready" ? `/d/${doc.id}` : "#"}
                    className="block truncate font-[family-name:var(--font-serif)] text-lg leading-tight hover:text-[var(--color-burgundy)]"
                  >
                    {doc.name}
                  </Link>
                  <p className="mt-1 font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
                    {doc.kind} · {formatBytes(doc.fileSize)} · {statusLabel(doc)}
                    {doc.errorMessage ? ` · ${doc.errorMessage}` : ""}
                  </p>
                </div>
                {doc.status === "ready" && (
                  <Link
                    href={`/d/${doc.id}`}
                    className="press hidden rounded-[4px] border border-[var(--color-ink)] px-3 py-1.5 text-xs tracking-wide text-[var(--color-ink)] sm:inline"
                  >
                    Open
                  </Link>
                )}
                {doc.status !== "ready" && (
                  <button
                    type="button"
                    onClick={() => void onRetry(doc)}
                    className="press hidden rounded-[4px] border border-[var(--color-rule)] px-3 py-1.5 text-xs tracking-wide text-[var(--color-ink-soft)] sm:inline"
                  >
                    Retry
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void onDelete(doc.id)}
                  className="rounded-[4px] p-2 text-[var(--color-ink-soft)] hover:text-[var(--color-burgundy)]"
                  aria-label={`Delete ${doc.name}`}
                >
                  <IconTrash className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      </div>
    </div>
  );
}
