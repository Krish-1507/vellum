import {
  addComparisonChanges,
  createComparison,
  getDocumentFull,
  listPages,
} from "@/lib/store";
import { diffDocuments, pageAtFactory, summariseDiffs } from "@/lib/compare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const body = (await req.json()) as { leftId?: string; rightId?: string };
  if (!body.leftId || !body.rightId) {
    return Response.json({ error: "Choose two documents." }, { status: 400 });
  }
  if (body.leftId === body.rightId) {
    return Response.json({ error: "Pick two different versions." }, { status: 400 });
  }

  const [leftFull, rightFull] = await Promise.all([
    getDocumentFull(body.leftId),
    getDocumentFull(body.rightId),
  ]);
  if (!leftFull || !rightFull) return Response.json({ error: "Document missing." }, { status: 404 });
  const left = leftFull.doc;
  const right = rightFull.doc;
  if (left.status !== "ready" || right.status !== "ready") {
    return Response.json({ error: "Both documents need to finish processing first." }, { status: 409 });
  }

  const [leftPages, rightPages] = await Promise.all([listPages(left.id), listPages(right.id)]);

  const changes = diffDocuments(
    leftFull.text,
    rightFull.text,
    pageAtFactory(leftPages),
    pageAtFactory(rightPages),
  );
  const summary = await summariseDiffs(left.name, right.name, changes, req.signal);

  const row = await createComparison(left.id, right.id, summary);
  const stored = await addComparisonChanges(
    row.id,
    changes.map((c, i) => ({ ...c, sortOrder: i })),
  );

  return Response.json({
    comparison: {
      id: row.id,
      summary,
      left: { id: left.id, name: left.name },
      right: { id: right.id, name: right.name },
      changes: stored,
    },
  });
}
