import { getConversation, getDocument, getMessage, listCitations, listMessages } from "@/lib/store";
import { buildAnswerDocx } from "@/lib/docxwrite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const conversationId = url.searchParams.get("conversationId") || "";
  if (!conversationId) return Response.json({ error: "Missing conversation." }, { status: 400 });

  const [conv, msg] = await Promise.all([
    getConversation(conversationId),
    getMessage(conversationId, id),
  ]);
  if (!conv || !msg) return Response.json({ error: "Not found." }, { status: 404 });

  const [rows, cites] = await Promise.all([
    listMessages(conversationId),
    listCitations(conversationId, [id]),
  ]);
  const idx = rows.findIndex((m) => m.id === id);
  const question = idx > 0 ? rows[idx - 1]!.content : conv.title;

  const docNames = new Map<string, string>();
  await Promise.all(
    [...new Set(cites.map((c) => c.documentId))].map(async (docId) => {
      const d = await getDocument(docId);
      if (d) docNames.set(docId, d.name);
    }),
  );

  const verified = cites.filter((c) => !c.omitted);
  const buf = buildAnswerDocx({
    title: conv.title,
    question,
    answer: msg.content,
    coverageNote: msg.coverageNote,
    citations: verified.map((c) => ({
      quote: c.displayText || c.quoteText,
      document: docNames.get(c.documentId) || "Document",
      page: c.pageNumber ? `p.${c.pageNumber}${c.pageEnd && c.pageEnd !== c.pageNumber ? `–${c.pageEnd}` : ""}` : "",
    })),
    dropped: cites.filter((c) => c.omitted).length,
  });
  const body = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return new Response(body, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="vellum-answer-${id.slice(0, 8)}.docx"`,
    },
  });
}
