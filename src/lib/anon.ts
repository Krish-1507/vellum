// Anonymisation: names, companies, emails and phone numbers become stable
// placeholders ([PERSON_1], [COMPANY_2], …), consistently and reversibly.
// Originals are always stored; only displayed text is masked.
import { chatComplete } from "./ai";
import type { Entity } from "./types";

const TOKEN_PREFIX: Record<Entity["kind"], string> = {
  person: "PERSON",
  company: "COMPANY",
  email: "EMAIL",
  phone: "PHONE",
  other: "ITEM",
};

function kindOf(raw: string): Entity["kind"] {
  const v = raw.toLowerCase();
  if (/@/.test(raw)) return "email";
  if (/^\+?[\d][\d\s().-]{6,}$/.test(raw)) return "phone";
  if (/\b(ltd|llc|inc|corp|company|partners|group|holdings|pjsc|llp)\b/i.test(raw)) return "company";
  if (/^[A-Z][a-z]+ [A-Z][a-z]+/.test(raw)) return "person";
  return "other";
}

const COMPANY_SUFFIX = /\s+(ltd|llc|inc|corp|corporation|company|partners|group|holdings|pjsc|llp|plc|sarl|gmbh)\.?$/i;

function aliasesFor(text: string, kind: Entity["kind"]): string[] {
  const out = new Set<string>([text]);
  if (kind === "company") {
    const short = text.replace(COMPANY_SUFFIX, "").trim();
    if (short.length >= 3 && short !== text) out.add(short);
  }
  if (kind === "person") {
    // Full name only — a bare surname collides with ordinary words too often.
    const parts = text.split(/\s+/);
    if (parts.length > 2) out.add(parts.slice(0, 2).join(" "));
  }
  return [...out];
}

export function assignTokens(found: Array<{ text: string; kind?: string }>): Entity[] {
  const counters: Record<string, number> = {};
  const seen = new Map<string, Entity>();
  const add = (text: string, kind: Entity["kind"], token: string) => {
    const key = text.toLowerCase();
    if (!key || seen.has(key)) return;
    seen.set(key, { text, kind, token });
  };
  for (const item of found) {
    const text = (item.text || "").trim();
    if (text.length < 2 || text.length > 80) continue;
    if (seen.has(text.toLowerCase())) continue;
    const kind = (["person", "company", "email", "phone", "other"] as const).includes(
      item.kind as Entity["kind"],
    )
      ? (item.kind as Entity["kind"])
      : kindOf(text);
    const n = (counters[kind] || 0) + 1;
    counters[kind] = n;
    const token = `[${TOKEN_PREFIX[kind]}_${n}]`;
    for (const alias of aliasesFor(text, kind)) add(alias, kind, token);
  }
  return [...seen.values()];
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function applyAnon(text: string, entities: Entity[]): string {
  if (!text || !entities.length) return text;
  const sorted = [...entities].sort((a, b) => b.text.length - a.text.length);
  let out = text;
  for (const e of sorted) {
    if (!e.text) continue;
    out = out.replace(new RegExp(escapeRegExp(e.text), "gi"), e.token);
  }
  return out;
}

// Streaming-safe masker. Text arrives in arbitrary token slices; an entity
// may straddle any boundary. The masker only emits text that can no longer
// be the prefix of an unfinished match: everything up to
// len(buffer) - HOLD, with matches fully inside the emitted region replaced
// and anything touching the holdback zone deferred to the next push/flush.
// Deterministic as long as entities are shorter than HOLD (capped at 80).
export function createStreamMasker(entities: Entity[], hold = 128) {
  const sorted = [...entities]
    .filter((e) => e.text && e.text.length <= hold)
    .sort((a, b) => b.text.length - a.text.length);
  const patterns = sorted.map((e) => ({
    re: new RegExp(escapeRegExp(e.text), "gi"),
    token: e.token,
  }));
  let carry = "";

  function replaceAll(s: string) {
    let out = s;
    for (const p of patterns) {
      out = out.replace(p.re, p.token);
      p.re.lastIndex = 0;
    }
    return out;
  }

  // Earliest index in buf where an unemittable (possibly partial) match starts.
  function holdFrom(buf: string): number {
    const safeEnd = Math.max(0, buf.length - hold);
    let cut = safeEnd;
    for (const e of sorted) {
      const needle = e.text.toLowerCase();
      // Any occurrence overlapping [safeEnd, end) forces the cut earlier.
      let from = Math.max(0, safeEnd - needle.length + 1);
      for (;;) {
        const idx = buf.toLowerCase().indexOf(needle, from);
        if (idx < 0 || idx >= safeEnd) break;
        if (idx + needle.length > safeEnd) {
          cut = Math.min(cut, idx);
          break;
        }
        from = idx + 1;
      }
    }
    return Math.max(0, cut);
  }

  return {
    push(text: string): string {
      if (!patterns.length) return text;
      const buf = carry + text;
      const cut = holdFrom(buf);
      carry = buf.slice(cut);
      return replaceAll(buf.slice(0, cut));
    },
    flush(): string {
      if (!patterns.length) {
        const rest = carry;
        carry = "";
        return rest;
      }
      const out = replaceAll(carry);
      carry = "";
      return out;
    },
  };
}

export function mergeEntities(lists: Entity[][]): Entity[] {
  const seen = new Map<string, Entity>();
  for (const list of lists) {
    for (const e of list) {
      const key = e.text.toLowerCase();
      if (!seen.has(key)) seen.set(key, e);
    }
  }
  return [...seen.values()];
}

// One cheap model call over the head of the document. Defensive parse:
// anything that is not a JSON array of {text} is ignored.
export async function extractEntities(
  text: string,
  signal?: AbortSignal,
): Promise<Array<{ text: string; kind?: string }>> {
  try {
    const head = text.slice(0, 6000);
    const { content } = await chatComplete({
      signal,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "List distinct real-world named entities in the passage: person names, company/organisation names, email addresses, phone numbers. Reply with ONLY a JSON array like [{\"text\": \"Acme Ltd\", \"kind\": \"company\"}]. No prose. Empty array if none.",
        },
        { role: "user", content: head },
      ],
    });
    const start = content.indexOf("[");
    const end = content.lastIndexOf("]");
    if (start < 0 || end <= start) return [];
    const parsed = JSON.parse(content.slice(start, end + 1)) as Array<{
      text?: string;
      kind?: string;
    }>;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p) => p && typeof p.text === "string" && p.text.trim())
      .slice(0, 80)
      .map((p) => ({ text: p.text!.trim(), kind: p.kind }));
  } catch {
    return [];
  }
}
