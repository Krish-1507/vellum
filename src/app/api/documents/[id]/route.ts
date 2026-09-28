import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  conversationDocuments,
  conversations,
  documents,
} from "@/db/schema";
import { documentSummary } from "@/lib/serialize";
import { removeStoredFile } from "@/lib/process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!doc) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({
    document: {
      ...documentSummary(doc),
      htmlContent: doc.htmlContent,
    },
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!doc) return Response.json({ error: "Not found" }, { status: 404 });

  const links = await db
    .select()
    .from(conversationDocuments)
    .where(eq(conversationDocuments.documentId, id));
  const convIds = [...new Set(links.map((l) => l.conversationId))];

  await db.delete(documents).where(eq(documents.id, id));
  for (const convId of convIds) {
    const remaining = await db
      .select()
      .from(conversationDocuments)
      .where(eq(conversationDocuments.conversationId, convId));
    if (remaining.length === 0) {
      await db.delete(conversations).where(eq(conversations.id, convId));
    }
  }
  await removeStoredFile(doc.storagePath);
  return Response.json({ ok: true });
}
