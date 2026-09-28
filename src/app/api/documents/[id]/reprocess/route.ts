import { getDocument, getDocumentFull } from "@/lib/store";
import { allowedFile } from "@/lib/files";
import { documentSummary } from "@/lib/serialize";
import { processDocument } from "@/lib/process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Recovery: re-run extraction from a fresh copy of the bytes (the browser
// keeps originals in IndexedDB). Covers failed files and jobs interrupted
// by a server restart — a stuck "processing" row is never terminal.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await getDocument(id);
  if (!doc) return Response.json({ error: "Not found." }, { status: 404 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Attach the original file to retry." }, { status: 400 });
  }
  const allowed = allowedFile(file.name, file.type);
  if (!allowed.ok || allowed.kind !== doc.kind) {
    return Response.json({ error: "That file does not match this document." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        const result = await processDocument(id, buffer, doc.kind, (message) =>
          send("status", { message }),
        );
        if (result.ok) {
          const full = await getDocumentFull(id);
          send("done", { document: full ? documentSummary(full.doc) : undefined });
        } else {
          send("error", { message: result.message });
        }
      } catch (err) {
        send("error", { message: err instanceof Error ? err.message : "Processing failed." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
