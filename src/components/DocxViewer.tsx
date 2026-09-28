"use client";

import { useEffect, useRef } from "react";
import { wrapTextQuote } from "@/lib/highlight";

export function DocxViewer({ html, quote }: { html: string; quote: string | null }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    if (!quote) return;
    const mark = wrapTextQuote(root, quote);
    mark?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [html, quote]);

  return (
    <div className="vellum-scroll h-full min-h-0 overflow-auto bg-[color-mix(in_srgb,var(--color-ink)_6%,var(--color-paper))] p-4 sm:p-6">
      <article
        ref={ref}
        dir="auto"
        className="sheet mx-auto max-w-2xl px-8 py-10 text-[15px] leading-relaxed sm:px-12 sm:py-14"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
