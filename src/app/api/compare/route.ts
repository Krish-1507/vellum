import { eq } from "drizzle-orm";
import { db } from "@/db";
import { comparisonChanges, comparisons, documentPages, documents } from "@/db/schema";
import { diffDocuments, pageAtFactory, summariseDiffs } from "@/lib/compare";
import { cleanPgText } from "@/lib/pgtext";

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

  const [left] = await db.select().from(documents).where(eq(documents.id, body.leftId)).limit(1);
  const [right] = await db.select().from(documents).where(eq(documents.id, body.rightId)).limit(1);
  if (!left || !right) return Response.json({ error: "Document missing." }, { status: 404 });
  if (left.status !== "ready" || right.status !== "ready") {
    return Response.json({ error: "Both documents need to finish processing first." }, { status: 409 });
  }

  const leftPages = await db.select().from(documentPages).where(eq(documentPages.documentId, left.id));
  const rightPages = await db.select().from(documentPages).where(eq(documentPages.documentId, right.id));

  const changes = diffDocuments(
    left.extractedText,
    right.extractedText,
    pageAtFactory(leftPages),
    pageAtFactory(rightPages),
  );
  const summary = await summariseDiffs(left.name, right.name, changes, req.signal);

  const [row] = await db
    .insert(comparisons)
    .values({
      leftDocumentId: left.id,
      rightDocumentId: right.id,
      summary: cleanPgText(summary),
    })
    .returning();

  if (changes.length) {
    await db.insert(comparisonChanges).values(
      changes.map((c, i) => ({
        comparisonId: row!.id,
        changeType: c.changeType,
        significance: c.significance,
        significanceScore: c.significanceScore,
        title: cleanPgText(c.title),
        explanation: cleanPgText(c.explanation),
        leftText: c.leftText ? cleanPgText(c.leftText) : c.leftText,
        rightText: c.rightText ? cleanPgText(c.rightText) : c.rightText,
        leftPage: c.leftPage,
        rightPage: c.rightPage,
        sortOrder: i,
      })),
    );
  }

  const stored = await db
    .select()
    .from(comparisonChanges)
    .where(eq(comparisonChanges.comparisonId, row!.id));

  return Response.json({
    comparison: {
      id: row!.id,
      summary,
      left: { id: left.id, name: left.name },
      right: { id: right.id, name: right.name },
      changes: stored,
    },
  });
}
