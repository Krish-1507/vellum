import { writeFile } from "fs/promises";
import path from "path";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { allowedFile, ensureUploadDir, safeFilename } from "@/lib/files";
import { saveUpload } from "@/lib/storage";
import { documentSummary } from "@/lib/serialize";
import { cleanPgText } from "@/lib/pgtext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db.select().from(documents).orderBy(desc(documents.createdAt));
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
  const id = crypto.randomUUID();
  const mimeType = cleanPgText(
    file.type || (allowed.kind === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
  );
  const { storagePath } = await saveUpload(id, file.name, buffer, mimeType || "application/octet-stream");

  const [row] = await db
    .insert(documents)
    .values({
      id,
      name: cleanPgText(file.name.replace(/\.(pdf|docx)$/i, "")),
      originalFilename: cleanPgText(file.name),
      mimeType,
      fileSize: file.size,
      storagePath,
      kind: allowed.kind,
      status: "queued",
      outlineJson: [],
      clausesJson: [],
    })
    .returning();

  return Response.json({ document: documentSummary(row!) }, { status: 201 });
}
