// Local neural embeddings (all-MiniLM-L6-v2, 384 dims) for semantic
// retrieval. Lazy singleton: the ~23MB model downloads once and caches.
// Everything is guarded — if the model can't load (offline, constrained
// host), callers fall back to lexical search and the app keeps working.
let extractorPromise: Promise<unknown> | null = null;

type Extractor = (texts: string | string[], opts?: Record<string, unknown>) => Promise<{ tolist: () => number[][] | number[] }>;

async function loader(): Promise<Extractor | null> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      try {
        const mod = (await import("@huggingface/transformers")) as unknown as {
          pipeline: (task: string, model: string, opts?: Record<string, unknown>) => Promise<Extractor>;
        };
        return await mod.pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
          dtype: "q8",
        });
      } catch {
        return null;
      }
    })();
  }
  return (await extractorPromise) as Extractor | null;
}

export async function embeddingsAvailable(): Promise<boolean> {
  return (await loader()) !== null;
}

export async function embedBatch(texts: string[]): Promise<number[][] | null> {
  const extractor = await loader();
  if (!extractor || !texts.length) return null;
  try {
    const out = await extractor(texts.slice(0, 800).map((t) => t.slice(0, 2000)), {
      pooling: "mean",
      normalize: true,
    });
    const rows = out.tolist() as number[][];
    return Array.isArray(rows[0]) ? (rows as number[][]) : [rows as unknown as number[]];
  } catch {
    return null;
  }
}

export function cosine(a: number[], b: number[]): number {
  if (!a?.length || a.length !== b?.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return dot; // vectors are L2-normalised
}
