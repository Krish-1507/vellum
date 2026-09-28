"use client";

import { useEffect, useRef, useState } from "react";
import { rectsForQuote, type HighlightRect, type PdfGlyph } from "@/lib/highlight";
import { IconChevron } from "./icons";

type PdfDoc = {
  numPages: number;
  getPage: (n: number) => Promise<{
    getViewport: (opts: { scale: number }) => {
      width: number;
      height: number;
      scale: number;
      convertToViewportPoint: (x: number, y: number) => number[];
    };
    render: (opts: {
      canvas: HTMLCanvasElement;
      viewport: { width: number; height: number; scale: number };
    }) => { promise: Promise<void> };
    getTextContent: () => Promise<{
      items: Array<{ str?: string; transform: number[]; width?: number; height?: number }>;
    }>;
  }>;
};

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      return mod;
    });
  }
  return pdfjsPromise;
}

export function PdfViewer({
  fileUrl,
  page,
  quote,
  occurrence = 0,
}: {
  fileUrl: string;
  page: number;
  quote: string | null;
  occurrence?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [total, setTotal] = useState(1);
  const [current, setCurrent] = useState(page || 1);
  const [rects, setRects] = useState<HighlightRect[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [cssSize, setCssSize] = useState({ w: 0, h: 0 });
  const pdfRef = useRef<PdfDoc | null>(null);
  const [readyTick, setReadyTick] = useState(0);

  useEffect(() => {
    setCurrent(page || 1);
  }, [page, fileUrl]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        const loading = pdfjs.getDocument({ url: fileUrl, withCredentials: false });
        const pdf = await loading.promise;
        if (cancelled) return;
        pdfRef.current = pdf as unknown as PdfDoc;
        setTotal(pdf.numPages);
        setReadyTick((n) => n + 1);
        setErr(null);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Could not open the PDF.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileUrl]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pdf = pdfRef.current;
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!pdf || !canvas || !wrap) return;
      const pageObj = await pdf.getPage(Math.min(Math.max(1, current), pdf.numPages));
      const base = pageObj.getViewport({ scale: 1 });
      const cssWidth = wrap.clientWidth || 640;
      const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      const scale = (cssWidth / base.width) * dpr;
      const viewport = pageObj.getViewport({ scale });
      if (!canvas.getContext("2d")) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${(base.height / base.width) * cssWidth}px`;
      setCssSize({ w: cssWidth, h: (base.height / base.width) * cssWidth });
      await pageObj.render({ canvas, viewport }).promise;
      if (cancelled) return;

      const content = await pageObj.getTextContent();
      const glyphs: PdfGlyph[] = [];
      for (const item of content.items) {
        if (!("str" in item) || !item.str) continue;
        const tx = item.transform;
        const pt = viewport.convertToViewportPoint(tx[4], tx[5]);
        const x = pt[0] ?? 0;
        const y = pt[1] ?? 0;
        const h = Math.abs(item.height || tx[0] || 10) * (viewport.scale / (pageObj.getViewport({ scale: 1 }).scale));
        const w = (item.width || 0) * (viewport.width / base.width);
        glyphs.push({
          str: item.str,
          x,
          y: y - h,
          w: w || item.str.length * (h * 0.45),
          h: h || 12,
        });
      }

      if (quote) {
        let found = rectsForQuote(glyphs, quote, viewport.width, viewport.height, occurrence);
        if (!found.length) {
          const words = quote.split(/\s+/).filter(Boolean);
          if (words.length > 8) {
            found = rectsForQuote(glyphs, words.slice(0, 12).join(" "), viewport.width, viewport.height, 0);
          }
          if (!found.length && words.length > 8) {
            found = rectsForQuote(glyphs, words.slice(-12).join(" "), viewport.width, viewport.height, 0);
          }
        }
        setRects(found);
        if (found.length) {
          requestAnimationFrame(() => {
            wrap.querySelector("[data-hit]")?.scrollIntoView({ behavior: "smooth", block: "center" });
          });
        }
      } else {
        setRects([]);
      }
    })().catch((e) => {
      if (!cancelled) setErr(e instanceof Error ? e.message : "Render failed.");
    });
    return () => {
      cancelled = true;
    };
  }, [current, quote, occurrence, fileUrl, readyTick]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-[var(--color-rule)] px-4 py-2">
        <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.16em] text-[var(--color-ink-soft)]">
          Page {current} of {total}
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded-[4px] p-1.5 hover:bg-[var(--color-paper-3)]"
            onClick={() => setCurrent((p) => Math.max(1, p - 1))}
            aria-label="Previous page"
          >
            <IconChevron className="h-4 w-4 rotate-180" />
          </button>
          <button
            type="button"
            className="rounded-[4px] p-1.5 hover:bg-[var(--color-paper-3)]"
            onClick={() => setCurrent((p) => Math.min(total, p + 1))}
            aria-label="Next page"
          >
            <IconChevron className="h-4 w-4" />
          </button>
        </div>
      </div>
      {err && <p className="px-4 py-3 text-sm text-[var(--color-burgundy)]">{err}</p>}
      <div ref={wrapRef} className="vellum-scroll min-h-0 flex-1 overflow-auto bg-[color-mix(in_srgb,var(--color-ink)_6%,var(--color-paper))] p-4">
        <div className="relative mx-auto" style={{ width: cssSize.w || "100%" }}>
          <canvas ref={canvasRef} className="sheet max-w-full" />
          {rects.map((r, i) => (
            <div
              key={`${r.left}-${r.top}-${i}`}
              data-hit={i === 0 ? "" : undefined}
              className="pointer-events-none absolute bg-[color-mix(in_srgb,var(--color-highlight)_55%,transparent)] mix-blend-multiply"
              style={{
                left: `${r.left}%`,
                top: `${r.top}%`,
                width: `${r.width}%`,
                height: `${Math.max(r.height, 1.2)}%`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
