"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { IconChat, IconMark, IconSplit, IconStack, IconUpload } from "./icons";

const NAV = [
  { href: "/", label: "Library", icon: IconUpload },
  { href: "/chat", label: "Chats", icon: IconChat },
  { href: "/compare", label: "Compare", icon: IconSplit },
  { href: "/ask", label: "Across files", icon: IconStack },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [clock, setClock] = useState("");
  const [health, setHealth] = useState<{
    database: string;
    dbMessage: string | null;
    ai: string;
    aiMessage: string | null;
  } | null>(null);

  useEffect(() => {
    const tick = () =>
      setClock(
        new Intl.DateTimeFormat("en-GB", {
          weekday: "short",
          day: "2-digit",
          month: "short",
        }).format(new Date()),
      );
    tick();
  }, []);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((j) => setHealth(j))
      .catch(() => undefined);
  }, []);

  const dbDown = health !== null && health.database !== "up";
  const aiMissing = health !== null && health.ai === "missing";

  return (
    <div className="flex min-h-[100dvh] flex-col lg:grid lg:h-[100dvh] lg:grid-cols-[15.5rem_minmax(0,1fr)]">
      <aside className="relative z-10 border-b border-[var(--color-rule)] bg-[color-mix(in_srgb,var(--color-paper-3)_70%,white)] lg:h-full lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between px-5 py-5 lg:block lg:px-6 lg:pt-8">
          <Link href="/" className="group block">
            <span className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-[4px] bg-[var(--color-ink)] text-[var(--color-paper)]">
                <IconMark className="h-5 w-5" />
              </span>
              <span>
                <span className="block font-[family-name:var(--font-serif)] text-[1.35rem] leading-none tracking-[-0.03em]">
                  Vellum
                </span>
                <span className="mt-1 block font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.22em] text-[var(--color-ink-soft)]">
                  Contract desk
                </span>
              </span>
            </span>
          </Link>
          <p className="hidden font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-soft)] lg:mt-8 lg:block">
            {clock}
          </p>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:block lg:space-y-1 lg:px-4 lg:pb-8">
          {NAV.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 rounded-[4px] px-3 py-2 text-sm transition-colors duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  active
                    ? "bg-[var(--color-ink)] text-[var(--color-paper)]"
                    : "text-[var(--color-ink-soft)] hover:bg-[color-mix(in_srgb,var(--color-ink)_6%,transparent)] hover:text-[var(--color-ink)]"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <p className="hidden px-6 pb-8 font-[family-name:var(--font-serif)] text-[13px] leading-relaxed text-[var(--color-ink-soft)] italic lg:block">
          Answers only from the page. Every claim, a citation.
        </p>
      </aside>
      <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {(dbDown || aiMissing) && (
          <div
            role="status"
            className={`shrink-0 px-5 py-2.5 text-[13px] leading-relaxed sm:px-8 ${
              dbDown
                ? "bg-[var(--color-burgundy)] text-[var(--color-paper-2)]"
                : "bg-[var(--color-highlight)] text-[var(--color-ink)]"
            }`}
          >
            {dbDown
              ? "The database is not reachable. For local work, run npm run db:emulator in another terminal (needs Java 17+)."
              : "No AI key found. Set GROQ_API_KEY in .env to enable chat, compare summaries and clause search."}
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
