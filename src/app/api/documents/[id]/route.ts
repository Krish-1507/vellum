import { deleteDocumentCascade, getDocumentFull } from "@/lib/store";
import { documentSummary } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const full = await getDocumentFull(id);
  if (!full) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({
    document: {
      ...documentSummary(full.doc),
      htmlContent: full.doc.htmlContent,
    },
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const full = await getDocumentFull(id);
  if (!full) return Response.json({ error: "Not found" }, { status: 404 });
  await deleteDocumentCascade(id);
  return Response.json({ ok: true });
}
