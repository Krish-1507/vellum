import { mkdir } from "fs/promises";
import path from "path";

export const UPLOAD_ROOT = path.join(process.cwd(), "data", "uploads");

export function allowedFile(filename: string, mime: string) {
  const lower = filename.toLowerCase();
  const isPdf = lower.endsWith(".pdf") || mime === "application/pdf";
  const isDocx =
    lower.endsWith(".docx") ||
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (isPdf) return { ok: true as const, kind: "pdf" as const };
  if (isDocx) return { ok: true as const, kind: "docx" as const };
  return {
    ok: false as const,
    message:
      "That file type is not supported. Upload a PDF (.pdf) or a Word document (.docx).",
  };
}

export async function ensureUploadDir(documentId: string) {
  const dir = path.join(UPLOAD_ROOT, documentId);
  await mkdir(dir, { recursive: true });
  return dir;
}

export function safeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 180) || "document";
}
