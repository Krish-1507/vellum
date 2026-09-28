import {
  countMessages,
  findConversationForDocs,
  getConversation,
  latestConversationForDoc,
  listCitations,
  listConversations,
  listMessages,
} from "@/lib/store";
import { serializeMessage } from "@/lib/serialize";
import { mergeEntities } from "@/lib/anon";
import type { Entity } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const documentId = url.searchParams.get("documentId");
  const ids = url.searchParams.get("documentIds");
  const conversationId = url.searchParams.get("id");
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();

  if (conversationId) {
    const conv = await getConversation(conversationId);
    if (!conv) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(await bundle(conv.id));
  }

  if (documentId) {
    const conv = await latestConversationForDoc(documentId);
    if (!conv) return Response.json({ conversation: null, messages: [] });
    return Response.json(await bundle(conv.id));
  }

  if (ids) {
    const wanted = ids.split(",").filter(Boolean);
    const conv = await findConversationForDocs(wanted, "multi");
    if (!conv) return Response.json({ conversation: null, messages: [] });
    return Response.json(await bundle(conv.id));
  }

  const convs = await listConversations();
  const withCounts = await Promise.all(
    convs.map(async (c) => ({ ...c, messageCount: await countMessages(c.id) })),
  );
  const filtered = q
    ? withCounts.filter((c) => c.title.toLowerCase().includes(q))
    : withCounts;
  // Document names for display.
  const { listDocuments } = await import("@/lib/store");
  const docs = await listDocuments();
  const names = Object.fromEntries(docs.map((d) => [d.id, d.name]));
  return Response.json({
    conversations: filtered.map((c) => ({
      ...c,
      documentNames: c.documentIds.map((id) => names[id] || "Document"),
    })),
  });
}

async function bundle(conversationId: string) {
  const conv = await getConversation(conversationId);
  const rows = await listMessages(conversationId);
  const msgIds = rows.map((m) => m.id);
  const cites = await listCitations(conversationId, msgIds);
  const entities = await entitiesFor(conv?.documentIds || []);
  const byMsg = new Map<string, typeof cites>();
  for (const c of cites) {
    const arr = byMsg.get(c.messageId) || [];
    arr.push(c);
    byMsg.set(c.messageId, arr);
  }
  return {
    conversation: conv,
    documentIds: conv?.documentIds || [],
    messages: rows.map((m) => serializeMessage(m, byMsg.get(m.id) || [], entities)),
  };
}

async function entitiesFor(documentIds: string[]): Promise<Entity[]> {
  if (!documentIds.length) return [];
  const { getDocument } = await import("@/lib/store");
  const docs = await Promise.all(documentIds.map((id) => getDocument(id)));
  return mergeEntities(
    docs.filter((d) => d?.anonymized).map((d) => d!.entitiesJson),
  );
}
