import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  conversationDocuments,
  conversations,
  messageCitations,
  messages,
} from "@/db/schema";
import { serializeMessage } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const documentId = url.searchParams.get("documentId");
  const ids = url.searchParams.get("documentIds");
  const conversationId = url.searchParams.get("id");

  if (conversationId) {
    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);
    if (!conv) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(await bundle(conv.id));
  }

  if (documentId) {
    const links = await db
      .select()
      .from(conversationDocuments)
      .where(eq(conversationDocuments.documentId, documentId));
    const convIds = links.map((l) => l.conversationId);
    if (!convIds.length) return Response.json({ conversation: null, messages: [] });

    const convs = await db
      .select()
      .from(conversations)
      .where(and(inArray(conversations.id, convIds), eq(conversations.mode, "single")))
      .orderBy(desc(conversations.updatedAt));
    const conv = convs[0];
    if (!conv) return Response.json({ conversation: null, messages: [] });
    return Response.json(await bundle(conv.id));
  }

  if (ids) {
    const wanted = ids.split(",").filter(Boolean).sort();
    const allLinks = await db.select().from(conversationDocuments);
    const byConv = new Map<string, string[]>();
    for (const link of allLinks) {
      const arr = byConv.get(link.conversationId) || [];
      arr.push(link.documentId);
      byConv.set(link.conversationId, arr);
    }
    for (const [convId, docIds] of byConv) {
      const sorted = [...new Set(docIds)].sort();
      if (sorted.join(",") === wanted.join(",")) {
        const [conv] = await db
          .select()
          .from(conversations)
          .where(and(eq(conversations.id, convId), eq(conversations.mode, "multi")))
          .limit(1);
        if (conv) return Response.json(await bundle(conv.id));
      }
    }
    return Response.json({ conversation: null, messages: [] });
  }

  const convs = await db.select().from(conversations).orderBy(desc(conversations.updatedAt));
  return Response.json({ conversations: convs });
}

async function bundle(conversationId: string) {
  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  const links = await db
    .select()
    .from(conversationDocuments)
    .where(eq(conversationDocuments.conversationId, conversationId));
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(messages.createdAt);
  const msgIds = rows.map((m) => m.id);
  const cites = msgIds.length
    ? await db.select().from(messageCitations).where(inArray(messageCitations.messageId, msgIds))
    : [];
  const byMsg = new Map<string, typeof cites>();
  for (const c of cites) {
    const arr = byMsg.get(c.messageId) || [];
    arr.push(c);
    byMsg.set(c.messageId, arr);
  }
  return {
    conversation: conv,
    documentIds: links.map((l) => l.documentId),
    messages: rows.map((m) => serializeMessage(m, byMsg.get(m.id) || [])),
  };
}
