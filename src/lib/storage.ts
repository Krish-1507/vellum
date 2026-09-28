// Uploaded files live on local disk in development, and in Firebase Cloud
// Storage in production (set FIREBASE_STORAGE_BUCKET, e.g.
// vellum-project.appspot.com). Serverless hosts have ephemeral disks, so
// without the bucket every upload would vanish on the next deploy.
// The DB stores either a local path or `fb:<object-key>` in storagePath.
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import { safeFilename, UPLOAD_ROOT } from "./files";

type Bucket = {
  file: (key: string) => {
    save: (data: Buffer, opts?: Record<string, unknown>) => Promise<void>;
    download: () => Promise<[Buffer]>;
    delete: (opts?: Record<string, unknown>) => Promise<void>;
  };
};

const bucketName = (process.env.FIREBASE_STORAGE_BUCKET || "").trim();
let bucketPromise: Promise<Bucket | null> | null = null;

async function getBucket(): Promise<Bucket | null> {
  if (!bucketName) return null;
  if (!bucketPromise) {
    bucketPromise = (async (): Promise<Bucket | null> => {
      try {
        // firebase-admin is CommonJS; the usable namespace may sit on
        // `.default` or at the top level depending on the bundler.
        type AdminLike = {
          apps: Array<{ name?: string }>;
          initializeApp: (opts: { storageBucket: string }) => void;
          storage: () => { bucket: () => Bucket };
        };
        const mod = (await import("firebase-admin")) as unknown as AdminLike & {
          default?: AdminLike;
        };
        const admin: AdminLike = mod.default ?? mod;
        if (admin.apps.length === 0) {
          // Production: Application Default Credentials from App Hosting.
          // Local: GOOGLE_APPLICATION_CREDENTIALS pointing at a service key.
          admin.initializeApp({ storageBucket: bucketName });
        }
        return admin.storage().bucket();
      } catch {
        return null;
      }
    })();
  }
  return bucketPromise;
}

export function storageMode(): "firebase" | "disk" {
  return bucketName ? "firebase" : "disk";
}

export async function saveUpload(
  documentId: string,
  originalName: string,
  buffer: Buffer,
  mimeType: string,
): Promise<{ storagePath: string; filename: string }> {
  const filename = safeFilename(originalName);
  const bucket = await getBucket();
  if (bucket) {
    const key = `uploads/${documentId}/${filename}`;
    await bucket.file(key).save(buffer, {
      contentType: mimeType,
      resumable: false,
      metadata: { cacheControl: "private, max-age=3600" },
    });
    return { storagePath: `fb:${key}`, filename };
  }
  const dir = path.join(UPLOAD_ROOT, documentId);
  await mkdir(dir, { recursive: true });
  const storagePath = path.join(dir, filename);
  await writeFile(storagePath, buffer);
  return { storagePath, filename };
}

export async function readStoredFile(storagePath: string): Promise<Buffer> {
  if (storagePath.startsWith("fb:")) {
    const bucket = await getBucket();
    if (!bucket) {
      throw new Error("This file lives in Firebase Storage, which is not configured here.");
    }
    const [downloaded] = await bucket.file(storagePath.slice(3)).download();
    return Buffer.from(downloaded);
  }
  return readFile(storagePath);
}

export async function removeStoredFile(storagePath: string) {
  try {
    if (storagePath.startsWith("fb:")) {
      const bucket = await getBucket();
      if (bucket) await bucket.file(storagePath.slice(3)).delete({ ignoreNotFound: true });
      return;
    }
    await unlink(storagePath);
  } catch {
    // file may already be gone
  }
}
