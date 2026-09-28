// Original file bytes live in the browser (IndexedDB), never on the server.
// Firestore keeps metadata + extracted text; the PDF page preview reads the
// bytes from here. If the bytes are absent (another browser), chat still
// works — only the page preview is unavailable.
const DB_NAME = "vellum-files";
const STORE = "files";

type FileRecord = {
  id: string;
  blob: Blob;
  name: string;
  mime: string;
  savedAt: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function saveLocalFile(id: string, file: Blob, name: string, mime: string): Promise<void> {
  try {
    await tx("readwrite", (s) =>
      s.put({ id, blob: file, name, mime, savedAt: Date.now() } as FileRecord),
    );
  } catch {
    // Private mode / quota: preview just won't be available here.
  }
}

export async function getLocalFile(id: string): Promise<Blob | null> {
  try {
    const rec = await tx("readonly", (s) => s.get(id) as IDBRequest<FileRecord | undefined>);
    return rec?.blob || null;
  } catch {
    return null;
  }
}

export async function deleteLocalFile(id: string): Promise<void> {
  try {
    await tx("readwrite", (s) => s.delete(id));
  } catch {
    // already gone
  }
}
