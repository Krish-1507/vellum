"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentActivity } from "@/lib/types";
import type { SerializedMessage } from "@/lib/types";
import { readSse } from "@/lib/sse";
import { IconAlert, IconCheck, IconQuote, IconSend, IconStop } from "./icons";

export type FocusCite = {
  documentId: string;
  quote: string;
  pageNumber: number | null;
  occurrence: number;
};

const SUGGESTIONS = [
  "What is the liability cap, and is it mutual?",
  "How can either party terminate?",
  "Which law governs, and where are disputes heard?",
];

export function ChatPane({
  documentIds,
  documentNames,
  conversationId,
  onConversation,
  onFocusCite,
}: {
  documentIds: string[];
  documentNames: Record<string, string>;
  conversationId: string | null;
  onConversation: (id: string) => void;
  onFocusCite: (cite: FocusCite) => void;
}) {
  const [messages, setMessages] = useState<SerializedMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [activity, setActivity] = useState<AgentActivity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const convRef = useRef(conversationId);

  convRef.current = conversationId;
  const docKey = documentIds.join("|");

  useEffect(() => {
    if (!documentIds.length) return;
    const qs =
      documentIds.length === 1
        ? `documentId=${documentIds[0]}`
        : `documentIds=${documentIds.join(",")}`;
    fetch(`/api/conversations?${qs}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.conversation?.id) onConversation(json.conversation.id);
        setMessages(json.messages || []);
      })
      .catch(() => undefined);
    // Reload when the set of files changes, not on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, activity, streaming]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || streaming) return;
    setError(null);
    setDraft("");
    setStreaming(true);
    setActivity([]);
    const userTemp: SerializedMessage = {
      id: `tmp-${crypto.randomUUID()}`,
      role: "user",
      content: question,
      status: "complete",
      coverage: null,
      coverageNote: null,
      activity: [],
      createdAt: new Date().toISOString(),
      citations: [],
      droppedUnverified: 0,
    };
    const asstTemp: SerializedMessage = {
      id: `tmp-a-${crypto.randomUUID()}`,
      role: "assistant",
      content: "",
      status: "streaming",
      coverage: null,
      coverageNote: null,
      activity: [],
      createdAt: new Date().toISOString(),
      citations: [],
      droppedUnverified: 0,
    };
    setMessages((m) => [...m, userTemp, asstTemp]);

    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentIds,
          conversationId: convRef.current,
          message: question,
        }),
        signal: abort.signal,
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error || "The question could not be sent.");
      }
      await readSse(res, {
        signal: abort.signal,
        onEvent: (event, data) => {
          if (event === "meta") {
            const meta = data as {
              conversationId: string;
              userMessage: SerializedMessage;
              assistantId: string;
            };
            onConversation(meta.conversationId);
            convRef.current = meta.conversationId;
            setMessages((m) => {
              const next = m.filter((x) => x.id !== userTemp.id && x.id !== asstTemp.id);
              return [
                ...next,
                meta.userMessage,
                { ...asstTemp, id: meta.assistantId, status: "streaming" },
              ];
            });
          }
          if (event === "status") {
            setActivity((a) => [...a, data as AgentActivity]);
          }
          if (event === "token") {
            const token = (data as { text: string }).text || "";
            setMessages((m) => {
              const copy = [...m];
              const last = copy[copy.length - 1];
              if (last?.role === "assistant") {
                copy[copy.length - 1] = { ...last, content: last.content + token };
              }
              return copy;
            });
          }
          if (event === "done") {
            const payload = data as { message: SerializedMessage };
            setMessages((m) => {
              const copy = [...m];
              copy[copy.length - 1] = payload.message;
              return copy;
            });
            setActivity([]);
          }
          if (event === "error") {
            setError((data as { message?: string }).message || "The model failed.");
          }
        },
      });
    } catch (err) {
      if ((err as Error).name === "AbortError" || abort.signal.aborted) {
        setMessages((m) => {
          const copy = [...m];
          const last = copy[copy.length - 1];
          if (last?.role === "assistant") {
            copy[copy.length - 1] = { ...last, status: "stopped" };
          }
          return copy;
        });
      } else {
        setError(err instanceof Error ? err.message : "The model failed.");
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="vellum-scroll min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-6 sm:px-7">
        {messages.length === 0 && (
          <div className="ink-in pt-8">
            <p className="font-[family-name:var(--font-serif)] text-3xl leading-tight">
              Ask what the contract actually says.
            </p>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-[var(--color-ink-soft)]">
              The model looks things up with tools — search, sections, pages — then we check every quote against the file before you see it.
            </p>
            <div className="mt-8 space-y-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                   className="press block w-full rounded-[4px] border border-[var(--color-rule)] bg-[var(--color-paper-2)] px-4 py-3 text-left text-sm hover:border-[var(--color-ink)]"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <article key={m.id} className="ink-in">
            {m.role === "user" ? (
              <p className="ml-8 rounded-[4px] bg-[var(--color-ink)] px-4 py-3 text-[15px] leading-relaxed text-[var(--color-paper-2)]">
                {m.content}
              </p>
            ) : (
              <div>
                <p className="font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.2em] text-[var(--color-ink-soft)]">
                  Vellum
                  {m.status === "stopped" ? " · stopped" : ""}
                  {m.status === "streaming" ? " · writing" : ""}
                </p>
                <div
                  className={`prose-answer mt-2 whitespace-pre-wrap font-[family-name:var(--font-serif)] text-[17px] leading-[1.55] ${
                    m.status === "streaming" ? "stream-caret" : ""
                  }`}
                >
                  {m.content || (m.status === "streaming" ? " " : "")}
                </div>
                {m.coverage === "partial" && m.coverageNote && (
                  <p className="mt-3 flex gap-2 text-xs text-[var(--color-ochre)]">
                    <IconAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {m.coverageNote}
                  </p>
                )}
                {m.droppedUnverified > 0 && (
                  <p className="mt-2 text-xs text-[var(--color-ink-soft)]">
                    {m.droppedUnverified === 1 ? "One citation" : `${m.droppedUnverified} citations`} could not be found in the document and {m.droppedUnverified === 1 ? "was" : "were"} omitted.
                  </p>
                )}
                {m.citations.length > 0 && (
                  <ul className="mt-4 space-y-2">
                    {m.citations.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() =>
                            onFocusCite({
                              documentId: c.documentId,
                              quote: c.quoteText,
                              pageNumber: c.pageNumber,
                              occurrence: c.occurrence,
                            })
                          }
                          className="w-full rounded-[4px] border border-[var(--color-rule)] bg-[var(--color-paper-2)] px-3 py-3 text-left hover:border-[var(--color-burgundy)]"
                        >
                          <span className="flex items-center justify-between gap-3">
                            <span className="flex items-center gap-1.5 font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.16em] text-[var(--color-forest)]">
                              <IconCheck className="h-3.5 w-3.5" />
                              Verified
                              {c.pageNumber ? ` · p.${c.pageNumber}${c.pageEnd && c.pageEnd !== c.pageNumber ? "–" + c.pageEnd : ""}` : ""}
                            </span>
                            <span className="flex items-center gap-1 text-[11px] text-[var(--color-burgundy)]">
                              <IconQuote className="h-3.5 w-3.5" />
                              Open
                            </span>
                          </span>
                          {documentIds.length > 1 && (
                            <span className="mt-1 block text-[11px] text-[var(--color-ink-soft)]">
                              {documentNames[c.documentId] || "Document"}
                            </span>
                          )}
                          <span className="mt-2 block text-[13px] leading-relaxed text-[var(--color-ink)]">
                            “{c.quoteText}”
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </article>
        ))}

        {streaming && activity.length > 0 && (
          <ol className="space-y-1.5 border-l border-[var(--color-rule)] pl-4">
            {activity.map((a, i) => (
              <li
                key={`${a.label}-${i}`}
                className="font-[family-name:var(--font-mono)] text-[11px] tracking-wide text-[var(--color-ink-soft)]"
                style={{ animation: "pulse-rule 1.6s ease-in-out infinite", animationDelay: `${i * 80}ms` }}
              >
                {a.label}
                {a.detail ? ` · ${a.detail}` : ""}
              </li>
            ))}
          </ol>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-[var(--color-rule)] bg-[color-mix(in_srgb,var(--color-paper)_88%,white)] p-4 sm:p-5">
        {error && (
          <p className="mb-3 flex gap-2 text-sm text-[var(--color-burgundy)]">
            <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft);
          }}
          className="flex items-end gap-2"
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(draft);
              }
            }}
            rows={2}
            placeholder="Ask about this contract…"
            className="min-h-[3.2rem] flex-1 resize-none rounded-[4px] border border-[var(--color-rule)] bg-[var(--color-paper-2)] px-3 py-2 text-sm outline-none focus:border-[var(--color-ink)]"
          />
          {streaming ? (
            <button
              type="button"
              onClick={stop}
              className="press flex h-11 w-11 items-center justify-center rounded-[4px] bg-[var(--color-burgundy)] text-[var(--color-paper)]"
              aria-label="Stop"
            >
              <IconStop className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!draft.trim()}
              className="press flex h-11 w-11 items-center justify-center rounded-[4px] bg-[var(--color-ink)] text-[var(--color-paper)] disabled:opacity-40"
              aria-label="Send"
            >
              <IconSend className="h-4 w-4" />
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
