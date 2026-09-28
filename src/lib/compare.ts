import { tokenize } from "./search";
import { normalizeForMatch } from "./quotes";
import { chatComplete, aiConfigured } from "./ai";

export type ClauseBlock = {
  heading: string;
  text: string;
  page: number;
};

export type DiffChange = {
  changeType: "added" | "removed" | "modified" | "reworded";
  significance: "high" | "medium" | "low";
  significanceScore: number;
  title: string;
  explanation: string;
  leftText: string | null;
  rightText: string | null;
  leftPage: number | null;
  rightPage: number | null;
};

const LEGAL_WEIGHT: Array<{ re: RegExp; weight: number; label: string }> = [
  { re: /\bliabilit(?:y|ies)|indemnif|hold harmless\b/i, weight: 40, label: "liability" },
  { re: /\bterminat|notice period|for convenience\b/i, weight: 32, label: "termination" },
  { re: /\b(?:usd|aed|eur|gbp|\$|£|€)\s?[\d,]+/i, weight: 38, label: "money" },
  { re: /\bcap\b|\baggregate\b|\bconsequential\b|\bindirect damage/i, weight: 36, label: "cap" },
  { re: /\bgoverning law|jurisdiction|arbitration\b/i, weight: 28, label: "forum" },
  { re: /\bconfidential|non-?compete|non-?solicit|intellectual property\b/i, weight: 26, label: "restrictive" },
  { re: /\bwarrant|indemnit|insurance\b/i, weight: 22, label: "risk" },
  { re: /\bpayment|invoice|fee|interest\b/i, weight: 20, label: "payment" },
  { re: /\bdata protection|personal data|gdpr\b/i, weight: 24, label: "privacy" },
  { re: /\bassignment|change of control\b/i, weight: 18, label: "assignment" },
];

function splitClauses(text: string, pageForOffset: (n: number) => number): ClauseBlock[] {
  const parts: ClauseBlock[] = [];
  const re =
    /(?=^(?:ARTICLE|Article|SECTION|Section|CLAUSE|Clause|SCHEDULE|Schedule)\b[^\n]{0,80}$|^\d+(?:\.\d+){0,3}\s+[A-Z][^\n]{0,80}$)/gm;
  const indices: number[] = [0];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > 0) indices.push(m.index);
  }
  indices.push(text.length);

  const unique = [...new Set(indices)].sort((a, b) => a - b);
  if (unique.length <= 2 && text.length > 800) {
    // No recognisable headings: fall back to paragraph blocks. Some extractors
    // join everything with single newlines, so also accept those as boundaries.
    let paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    if (paras.length <= 1) {
      paras = text
        .split(/\n/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
    }
    let offset = 0;
    let current = "";
    let currentStart = 0;
    const pushCurrent = () => {
      const trimmed = current.trim();
      if (trimmed.length >= 40) {
        const first = trimmed.split("\n")[0]!.slice(0, 80);
        parts.push({
          heading: first.replace(/\s+/g, " "),
          text: trimmed,
          page: pageForOffset(currentStart),
        });
      }
      current = "";
    };
    for (const para of paras) {
      if (!current) currentStart = offset;
      current = current ? `${current}\n${para}` : para;
      offset += para.length + 1;
      if (current.length >= 500) pushCurrent();
    }
    pushCurrent();
    if (parts.length) return parts;
    // Last resort: fixed-size slices so huge blobs still diff per passage.
    const size = 600;
    for (let at = 0; at < text.length; at += size) {
      const slice = text.slice(at, at + size).trim();
      if (slice.length < 40) continue;
      parts.push({
        heading: slice.split("\n")[0]!.slice(0, 80).replace(/\s+/g, " "),
        text: slice,
        page: pageForOffset(at),
      });
    }
    return parts;
  }

  for (let i = 0; i < unique.length - 1; i++) {
    const start = unique[i]!;
    const end = unique[i + 1]!;
    const slice = text.slice(start, end).trim();
    if (slice.length < 40) continue;
    const first = slice.split("\n")[0]!.slice(0, 90);
    parts.push({
      heading: first.replace(/\s+/g, " "),
      text: slice,
      page: pageForOffset(start),
    });
  }
  return parts;
}

function jaccard(a: string, b: string) {
  const sa = new Set(tokenize(a));
  const sb = new Set(tokenize(b));
  if (!sa.size && !sb.size) return 1;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter += 1;
  return inter / (sa.size + sb.size - inter || 1);
}

function numbersOf(text: string) {
  return (text.match(/(?:USD|AED|EUR|GBP|\$|£|€)?\s?\d[\d,]*(?:\.\d+)?%?/gi) || [])
    .map((s) => s.replace(/\s+/g, "").toLowerCase())
    .sort();
}

function numbersChanged(a: string, b: string) {
  const na = numbersOf(a).join("|");
  const nb = numbersOf(b).join("|");
  return na !== nb && (na.length > 0 || nb.length > 0);
}

function legalScore(text: string) {
  let score = 0;
  const labels: string[] = [];
  for (const item of LEGAL_WEIGHT) {
    if (item.re.test(text)) {
      score += item.weight;
      labels.push(item.label);
    }
  }
  return { score, labels };
}

function titleFrom(change: DiffChange) {
  const src = change.rightText || change.leftText || "Clause";
  const line = src.split("\n")[0]!.replace(/\s+/g, " ").slice(0, 72);
  return line || change.changeType;
}

function explain(change: Omit<DiffChange, "title" | "explanation"> & { labels: string[] }): string {
  if (change.changeType === "added") {
    return `A clause appears in the revised draft that is not in the original${change.labels.length ? ` (${change.labels.join(", ")})` : ""}.`;
  }
  if (change.changeType === "removed") {
    return `A clause in the original does not appear in the revised draft${change.labels.length ? ` (${change.labels.join(", ")})` : ""}.`;
  }
  if (change.changeType === "reworded") {
    return "The wording changed but the substance looks the same — likely a tidy-up rather than a commercial shift.";
  }
  if (numbersChanged(change.leftText || "", change.rightText || "")) {
    return "Figures in this clause moved. Check caps, fees, notice periods and percentages by hand.";
  }
  return `The clause was rewritten in a way that may change the deal${change.labels.length ? ` (${change.labels.join(", ")})` : ""}.`;
}

export function diffDocuments(
  leftText: string,
  rightText: string,
  leftPageAt: (n: number) => number,
  rightPageAt: (n: number) => number,
): DiffChange[] {
  const left = splitClauses(leftText, leftPageAt);
  const right = splitClauses(rightText, rightPageAt);
  const usedRight = new Set<number>();
  const changes: DiffChange[] = [];

  for (const l of left) {
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < right.length; i++) {
      if (usedRight.has(i)) continue;
      const s = jaccard(l.text, right[i]!.text);
      const headingBoost =
        l.heading && right[i]!.heading && jaccard(l.heading, right[i]!.heading) > 0.5 ? 0.08 : 0;
      const score = s + headingBoost;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }

    if (best === -1 || bestScore < 0.28) {
      const legal = legalScore(l.text);
      const significanceScore = 20 + legal.score;
      const significance = significanceScore >= 50 ? "high" : significanceScore >= 28 ? "medium" : "low";
      const draft: DiffChange = {
        changeType: "removed",
        significance,
        significanceScore,
        title: "",
        explanation: "",
        leftText: l.text.slice(0, 2500),
        rightText: null,
        leftPage: l.page,
        rightPage: null,
      };
      draft.title = titleFrom(draft);
      draft.explanation = explain({ ...draft, labels: legal.labels });
      changes.push(draft);
      continue;
    }

    usedRight.add(best);
    const r = right[best]!;
    const ln = normalizeForMatch(l.text).norm;
    const rn = normalizeForMatch(r.text).norm;
    if (ln === rn) continue;

    const legal = legalScore(l.text + " " + r.text);
    const num = numbersChanged(l.text, r.text);
    const reworded = bestScore >= 0.82 && !num;
    const changeType = reworded ? "reworded" : "modified";
    let significanceScore = (reworded ? 8 : 22) + legal.score + (num ? 30 : 0);
    if (reworded && !num) significanceScore = Math.min(significanceScore, 24);
    const significance = significanceScore >= 50 ? "high" : significanceScore >= 28 ? "medium" : "low";
    const draft: DiffChange = {
      changeType,
      significance,
      significanceScore,
      title: "",
      explanation: "",
      leftText: l.text.slice(0, 2500),
      rightText: r.text.slice(0, 2500),
      leftPage: l.page,
      rightPage: r.page,
    };
    draft.title = titleFrom(draft);
    draft.explanation = explain({ ...draft, labels: legal.labels });
    changes.push(draft);
  }

  right.forEach((r, i) => {
    if (usedRight.has(i)) return;
    const legal = legalScore(r.text);
    const significanceScore = 20 + legal.score;
    const significance = significanceScore >= 50 ? "high" : significanceScore >= 28 ? "medium" : "low";
    const draft: DiffChange = {
      changeType: "added",
      significance,
      significanceScore,
      title: "",
      explanation: "",
      leftText: null,
      rightText: r.text.slice(0, 2500),
      leftPage: null,
      rightPage: r.page,
    };
    draft.title = titleFrom(draft);
    draft.explanation = explain({ ...draft, labels: legal.labels });
    changes.push(draft);
  });

  changes.sort((a, b) => b.significanceScore - a.significanceScore);
  return changes;
}

export async function summariseDiffs(
  leftName: string,
  rightName: string,
  changes: DiffChange[],
  signal?: AbortSignal,
): Promise<string> {
  const high = changes.filter((c) => c.significance === "high");
  const medium = changes.filter((c) => c.significance === "medium");
  const reworded = changes.filter((c) => c.changeType === "reworded").length;
  const fallback = [
    `${changes.length} clause-level difference${changes.length === 1 ? "" : "s"} between “${leftName}” and “${rightName}”.`,
    high.length
      ? `${high.length} look commercially material — typically money, liability, termination or governing law.`
      : "None of the differences look like a commercial rewrite at first pass.",
    medium.length ? `${medium.length} may matter depending on the deal.` : "",
    reworded ? `${reworded} ${reworded === 1 ? "is" : "are"} wording-only and should not be confused with a change in substance.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (!aiConfigured()) return fallback;

  try {
    const digest = changes
      .slice(0, 18)
      .map(
        (c, i) =>
          `${i + 1}. [${c.significance}/${c.changeType}] ${c.title}\n${c.explanation}\nLEFT: ${(c.leftText || "—").slice(0, 400)}\nRIGHT: ${(c.rightText || "—").slice(0, 400)}`,
      )
      .join("\n\n");
    const result = await chatComplete({
      temperature: 0.2,
      signal,
      messages: [
        {
          role: "system",
          content:
            "You summarise contract redlines for a lawyer. Distinguish substance from mere rewording. Never invent numbers. 2–4 short paragraphs. No bullets unless a figure actually moved.",
        },
        {
          role: "user",
          content: `Original: ${leftName}\nRevised: ${rightName}\n\n${digest}`,
        },
      ],
    });
    return result.content.trim() || fallback;
  } catch {
    return fallback;
  }
}

export function pageAtFactory(pages: Array<{ pageNumber: number; charStart: number; charEnd: number }>) {
  return (offset: number) => {
    for (const p of pages) {
      if (offset >= p.charStart && offset < p.charEnd) return p.pageNumber;
    }
    return pages[pages.length - 1]?.pageNumber ?? 1;
  };
}
