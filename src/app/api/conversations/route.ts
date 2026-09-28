import {
  findConversationForDocs,
  getConversation,
  latestConversationForDoc,
  listCitations,
  listConversations,
  listMessages,
} from "@/lib/store";
import { serializeMessage } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const documentId = url.searchParams.get("documentId");
  const ids = url.searchParams.get("documentIds");
  const conversationId = url.searchParams.get("id");

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
  return Response.json({ conversations: convs });
}

async function bundle(conversationId: string) {
  const conv = await getConversation(conversationId);
  const rows = await listMessages(conversationId);
  const msgIds = rows.map((m) => m.id);
  const cites = await listCitations(conversationId, msgIds);
  const byMsg = new Map<string, typeof cites>();
  for (const c of cites) {
    const arr = byMsg.get(c.messageId) || [];
    arr.push(c);
    byMsg.set(c.messageId, arr);
  }
  return {
    conversation: conv,
    documentIds: conv?.documentIds || [],
    messages: rows.map((m) => serializeMessage(m, byMsg.get(m.id) || [])),
  };
}
