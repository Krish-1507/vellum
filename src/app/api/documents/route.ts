import { createDocument, getDocumentFull } from "@/lib/store";
import { allowedFile } from "@/lib/files";
import { documentSummary } from "@/lib/serialize";
import { processDocument } from "@/lib/process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  const { listDocuments } = await import("@/lib/store");
  const rows = await listDocuments();
  return Response.json({ documents: rows.map(documentSummary) });
}

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Choose a PDF or Word file to upload." }, { status: 400 });
  }

  const allowed = allowedFile(file.name, file.type);
  if (!allowed.ok) {
    return Response.json({ error: allowed.message }, { status: 400 });
  }

  if (file.size > 40 * 1024 * 1024) {
    return Response.json({ error: "File is over 40 MB." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const row = await createDocument({
    name: file.name.replace(/\.(pdf|docx)$/i, ""),
    originalFilename: file.name,
    mimeType:
      file.type ||
      (allowed.kind === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    fileSize: file.size,
    kind: allowed.kind,
  });

  // Stream extraction progress; the client keeps the original bytes in
  // IndexedDB, the server only stores the extracted text in Firestore.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        send("status", { message: "Uploading…" });
        const result = await processDocument(row.id, buffer, allowed.kind, (message) =>
          send("status", { message }),
        );
        if (result.ok) {
          const full = await getDocumentFull(row.id);
          send("done", { document: full ? documentSummary(full.doc) : documentSummary(row) });
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
    status: 201,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
