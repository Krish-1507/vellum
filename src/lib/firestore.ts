// Firestore access (Admin SDK). Local: Firestore emulator via
// FIRESTORE_EMULATOR_HOST. Production (App Hosting): Application Default
// Credentials + FIREBASE_PROJECT_ID. No Postgres anywhere in this file.
import { cleanJson } from "./pgtext";

const projectId = process.env.FIREBASE_PROJECT_ID || "vellum-project";

type FirestoreDb = import("firebase-admin/firestore").Firestore;
let cached: FirestoreDb | null = null;

export async function getDb(): Promise<FirestoreDb> {
  if (cached) return cached;
  const admin = await import("firebase-admin");
  const apps = (admin as unknown as { apps: unknown[] }).apps || [];
  if (apps.length === 0) {
    const init = (
      admin as unknown as {
        initializeApp: (opts: Record<string, string | undefined>) => void;
      }
    ).initializeApp;
    init({ projectId });
  }
  const { getFirestore } = await import("firebase-admin/firestore");
  cached = getFirestore();
  return cached;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}

// Firestore documents cap at 1 MiB. Contract text (and Word HTML) can exceed
// that on very large files, so oversized strings spill into parts.
const PART_BYTES = 800_000;

export async function writeBigString(
  docRef: import("firebase-admin/firestore").DocumentReference,
  field: string,
  value: string | null,
): Promise<void> {
  const partsRef = docRef.collection("bigfields").doc(field);
  const existing = await partsRef.collection("parts").listDocuments();
  await Promise.all(existing.map((d) => d.delete()));
  await partsRef.delete().catch(() => undefined);
  if (value == null) return;
  const bytes = Buffer.byteLength(value);
  if (bytes <= PART_BYTES) {
    await docRef.set({ [field]: cleanJson(value) }, { merge: true });
    return;
  }
  await docRef.set({ [field]: null, [`${field}Chunked`]: true }, { merge: true });
  const buf = Buffer.from(value);
  let i = 0;
  for (let at = 0; at < buf.length; at += PART_BYTES) {
    await partsRef
      .collection("parts")
      .doc(String(i))
      .set({ i, text: buf.subarray(at, at + PART_BYTES).toString() });
    i += 1;
  }
}

export async function readBigString(
  docRef: import("firebase-admin/firestore").DocumentReference,
  snapData: Record<string, unknown>,
  field: string,
): Promise<string | null> {
  if (typeof snapData[field] === "string") return snapData[field] as string;
  if (snapData[`${field}Chunked`]) {
    const parts = await docRef.collection("bigfields").doc(field).collection("parts").orderBy("i").get();
    return parts.docs.map((d) => (d.data().text as string) || "").join("") || null;
  }
  return null;
}
