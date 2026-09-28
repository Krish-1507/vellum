import { getDocument, getDocumentFull, getDocumentText, updateDocument } from "@/lib/store";
import { assignTokens, extractEntities } from "@/lib/anon";
import { documentSummary } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Reversible anonymisation toggle. Turning it on extracts entities lazily
// (one cheap model call over the head of the document) and stores the
// mapping; turning it off restores originals everywhere. Originals are
// always stored — only displayed text is masked.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { anonymized?: boolean };
  const doc = await getDocument(id);
  if (!doc) return Response.json({ error: "Not found." }, { status: 404 });

  let entities = doc.entitiesJson;
  if (body.anonymized && !entities.length) {
    const text = await getDocumentText(id);
    entities = assignTokens(await extractEntities(text, req.signal));
    await updateDocument(id, { entities });
  }
  await updateDocument(id, { anonymized: Boolean(body.anonymized) });

  const full = await getDocumentFull(id);
  if (!full) return Response.json({ error: "Not found." }, { status: 404 });
  return Response.json({
    document: documentSummary(full.doc),
    entities: full.doc.entitiesJson,
  });
}
