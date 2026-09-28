// Postgres `text`/`jsonb` reject NUL bytes and lone surrogates, and model
// output plus PDF extraction both occasionally contain them. Strip them at
// every write site instead of debugging one 500 at a time.
const NUL = String.fromCharCode(0);

export function cleanPgText(value: string): string {
  if (!value) return value;
  return value
    .split(NUL)
    .join("")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

export function cleanJson<T>(value: T): T {
  if (typeof value === "string") return cleanPgText(value) as unknown as T;
  if (Array.isArray(value)) return value.map(cleanJson) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[cleanPgText(k)] = cleanJson(v);
    return out as T;
  }
  return value;
}
