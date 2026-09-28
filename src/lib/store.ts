// Data-access layer over Firestore. Mirrors the old relational shape so the
// API routes and the agent keep working without learning Firestore.
import { getDb, newId, nowIso, readBigString, writeBigString } from "./firestore";
import { cleanJson, cleanPgText } from "./pgtext";
import type {
  AgentActivity,
  Entity,
  ExtractedClause,
  OutlineEntry,
} from "./types";

export type DocRow = {
  id: string;
  name: string;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  kind: string;
  status: string;
  errorMessage: string | null;
  pageCount: number;
  charCount: number;
  outlineJson: OutlineEntry[];
  clausesJson: ExtractedClause[];
  coverageNote: string | null;
  htmlContent: string | null;
  storagePath: string | null;
  anonymized: boolean;
  entitiesJson: Entity[];
  createdAt: Date;
  updatedAt: Date;
};

export type PageRow = {
  documentId: string;
  pageNumber: number;
  text: string;
  charStart: number;
  charEnd: number;
};

export type ChunkRow = {
  documentId: string;
  chunkIndex: number;
  heading: string | null;
  text: string;
  pageStart: number;
  pageEnd: number;
  charStart: number;
  charEnd: number;
  embedding?: number[] | null;
};

export type ConvRow = {
  id: string;
  title: string;
  mode: string;
  documentIds: string[];
  createdAt: Date;
  updatedAt: Date;
};

export type MsgRow = {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  status: string;
  coverage: string | null;
  coverageNote: string | null;
  activityJson: AgentActivity[];
  createdAt: Date;
};

export type CiteRow = {
  id: string;
  messageId: string;
  documentId: string;
  quoteText: string;
  verified: boolean;
  displayText: string | null;
  pageNumber: number | null;
  pageEnd: number | null;
  charStart: number | null;
  charEnd: number | null;
  occurrence: number;
  totalOccurrences: number;
  omitted: boolean;
};

export type CmpRow = {
  id: string;
  leftDocumentId: string;
  rightDocumentId: string;
  summary: string;
  createdAt: Date;
};

export type ChangeRow = {
  id: string;
  comparisonId: string;
  changeType: string;
  significance: string;
  significanceScore: number;
  title: string;
  explanation: string;
  leftText: string | null;
  rightText: string | null;
  leftPage: number | null;
  rightPage: number | null;
  sortOrder: number;
};

function toDate(v: unknown): Date {
  if (v instanceof Date) return v;
  if (typeof v === "string") return new Date(v);
  const t = v as { toDate?: () => Date } | null;
  if (t && typeof t.toDate === "function") return t.toDate();
  return new Date();
}

async function deleteCollection(
  db: import("firebase-admin/firestore").Firestore,
  col: import("firebase-admin/firestore").CollectionReference,
) {
  for (;;) {
    const snap = await col.limit(400).get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

// ---------- documents ----------

export async function listDocuments(): Promise<DocRow[]> {
  const db = await getDb();
  const snap = await db.collection("documents").orderBy("createdAt", "desc").get();
  return snap.docs.map((d) => docFromSnap(d.id, d.data()));
}

export async function getDocument(id: string): Promise<DocRow | null> {
  const db = await getDb();
  const ref = db.collection("documents").doc(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  return docFromSnap(snap.id, snap.data()!);
}

function docFromSnap(id: string, data: Record<string, unknown>): DocRow {
  return {
    id,
    name: (data.name as string) || "",
    originalFilename: (data.originalFilename as string) || "",
    mimeType: (data.mimeType as string) || "",
    fileSize: (data.fileSize as number) || 0,
    kind: (data.kind as string) || "",
    status: (data.status as string) || "queued",
    errorMessage: (data.errorMessage as string | null) ?? null,
    pageCount: (data.pageCount as number) || 0,
    charCount: (data.charCount as number) || 0,
    outlineJson: (data.outline as OutlineEntry[]) || [],
    clausesJson: (data.clauses as ExtractedClause[]) || [],
    coverageNote: (data.coverageNote as string | null) ?? null,
    htmlContent: typeof data.htmlContent === "string" ? (data.htmlContent as string) : null,
    storagePath: (data.storagePath as string | null) ?? null,
    anonymized: Boolean(data.anonymized),
    entitiesJson: (data.entities as Entity[]) || [],
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  };
}

export async function getDocumentFull(id: string): Promise<{ doc: DocRow; text: string } | null> {
  const db = await getDb();
  const ref = db.collection("documents").doc(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data()!;
  const [text, html] = await Promise.all([
    readBigString(ref, data, "extractedText"),
    readBigString(ref, data, "htmlContent"),
  ]);
  const doc = docFromSnap(snap.id, data);
  doc.htmlContent = html;
  return { doc, text: text || "" };
}

export type DocText = { text: string };

export async function getDocumentText(id: string): Promise<string> {
  const db = await getDb();
  const ref = db.collection("documents").doc(id);
  const snap = await ref.get();
  if (!snap.exists) return "";
  return (await readBigString(ref, snap.data()!, "extractedText")) || "";
}

export async function createDocument(input: {
  name: string;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  kind: string;
}): Promise<DocRow> {
  const db = await getDb();
  const id = newId();
  const now = nowIso();
  const data = {
    name: cleanPgText(input.name),
    originalFilename: cleanPgText(input.originalFilename),
    mimeType: cleanPgText(input.mimeType),
    fileSize: input.fileSize,
    kind: input.kind,
    status: "queued",
    errorMessage: null,
    pageCount: 0,
    charCount: 0,
    outline: [],
    clauses: [],
    coverageNote: null,
    htmlContent: null,
    extractedText: "",
    storagePath: null,
    anonymized: false,
    entities: [],
    createdAt: now,
    updatedAt: now,
  };
  await db.collection("documents").doc(id).set(data);
  return docFromSnap(id, data);
}

export async function updateDocument(id: string, patch: Partial<Record<string, unknown>>) {
  const db = await getDb();
  const cleaned = cleanJson(patch);
  await db
    .collection("documents")
    .doc(id)
    .set({ ...cleaned, updatedAt: nowIso() }, { merge: true });
}

export async function setDocumentText(
  id: string,
  text: string,
  html: string | null,
  meta: {
    status: string;
    pageCount: number;
    charCount: number;
    outline: OutlineEntry[];
    clauses: ExtractedClause[];
  },
) {
  const db = await getDb();
  const ref = db.collection("documents").doc(id);
  await ref.set(
    {
      status: meta.status,
      pageCount: meta.pageCount,
      charCount: meta.charCount,
      outline: cleanJson(meta.outline),
      clauses: cleanJson(meta.clauses),
      errorMessage: null,
      updatedAt: nowIso(),
    },
    { merge: true },
  );
  await writeBigString(ref, "extractedText", cleanPgText(text));
  await writeBigString(ref, "htmlContent", html ? cleanPgText(html) : null);
}

export async function deleteDocumentCascade(id: string) {
  const db = await getDb();
  const ref = db.collection("documents").doc(id);
  await deleteCollection(db, ref.collection("pages"));
  await deleteCollection(db, ref.collection("chunks"));
  await deleteCollection(db, ref.collection("bigfields").doc("extractedText").collection("parts"));
  await deleteCollection(db, ref.collection("bigfields").doc("htmlContent").collection("parts"));
  await ref.delete().catch(() => undefined);
  // Detach from conversations; drop conversations left with no documents.
  const linked = await db.collection("conversations").where("documentIds", "array-contains", id).get();
  for (const c of linked.docs) {
    const ids = ((c.data().documentIds as string[]) || []).filter((x) => x !== id);
    if (!ids.length) {
      await deleteConversationCascade(c.id);
    } else {
      await c.ref.set({ documentIds: ids, updatedAt: nowIso() }, { merge: true });
    }
  }
}

// ---------- pages & chunks ----------

export async function replacePages(id: string, pages: PageRow[]) {
  const db = await getDb();
  const ref = db.collection("documents").doc(id);
  await deleteCollection(db, ref.collection("pages"));
  if (!pages.length) return;
  let batch = db.batch();
  let n = 0;
  for (const p of pages) {
    batch.set(ref.collection("pages").doc(String(p.pageNumber)), {
      pageNumber: p.pageNumber,
      text: cleanPgText(p.text),
      charStart: p.charStart,
      charEnd: p.charEnd,
    });
    n += 1;
    if (n >= 400) {
      await batch.commit();
      batch = db.batch();
      n = 0;
    }
  }
  if (n > 0) await batch.commit();
}

export async function replaceChunks(id: string, chunks: ChunkRow[]) {
  const db = await getDb();
  const ref = db.collection("documents").doc(id);
  await deleteCollection(db, ref.collection("chunks"));
  if (!chunks.length) return;
  let batch = db.batch();
  let n = 0;
  for (const c of chunks) {
    batch.set(ref.collection("chunks").doc(String(c.chunkIndex)), {
      chunkIndex: c.chunkIndex,
      heading: c.heading ? cleanPgText(c.heading) : null,
      text: cleanPgText(c.text),
      pageStart: c.pageStart,
      pageEnd: c.pageEnd,
      charStart: c.charStart,
      charEnd: c.charEnd,
      embedding: c.embedding && c.embedding.length ? c.embedding : null,
    });
    n += 1;
    if (n >= 400) {
      await batch.commit();
      batch = db.batch();
      n = 0;
    }
  }
  if (n > 0) await batch.commit();
}

export async function listPages(documentId: string): Promise<PageRow[]> {
  const db = await getDb();
  const snap = await db
    .collection("documents")
    .doc(documentId)
    .collection("pages")
    .orderBy("pageNumber")
    .get();
  return snap.docs.map((d) => {
    const v = d.data();
    return {
      documentId,
      pageNumber: v.pageNumber as number,
      text: (v.text as string) || "",
      charStart: (v.charStart as number) || 0,
      charEnd: (v.charEnd as number) || 0,
    };
  });
}

export async function listChunks(documentId: string): Promise<ChunkRow[]> {
  const db = await getDb();
  const snap = await db
    .collection("documents")
    .doc(documentId)
    .collection("chunks")
    .orderBy("chunkIndex")
    .get();
  return snap.docs.map((d) => {
    const v = d.data();
    return {
      documentId,
      chunkIndex: v.chunkIndex as number,
      heading: (v.heading as string | null) ?? null,
      text: (v.text as string) || "",
      pageStart: (v.pageStart as number) || 1,
      pageEnd: (v.pageEnd as number) || 1,
      charStart: (v.charStart as number) || 0,
      charEnd: (v.charEnd as number) || 0,
      embedding: (v.embedding as number[] | null) ?? null,
    };
  });
}

export async function updateChunkEmbeddings(documentId: string, vectors: Map<number, number[]>) {
  if (!vectors.size) return;
  const db = await getDb();
  const ref = db.collection("documents").doc(documentId);
  let batch = db.batch();
  let n = 0;
  for (const [index, vec] of vectors) {
    batch.set(ref.collection("chunks").doc(String(index)), { embedding: vec }, { merge: true });
    n += 1;
    if (n >= 200) {
      await batch.commit();
      batch = db.batch();
      n = 0;
    }
  }
  if (n > 0) await batch.commit();
}

// ---------- conversations & messages ----------

export async function getConversation(id: string): Promise<ConvRow | null> {
  const db = await getDb();
  const snap = await db.collection("conversations").doc(id).get();
  if (!snap.exists) return null;
  const v = snap.data()!;
  return {
    id: snap.id,
    title: (v.title as string) || "Untitled",
    mode: (v.mode as string) || "single",
    documentIds: (v.documentIds as string[]) || [],
    createdAt: toDate(v.createdAt),
    updatedAt: toDate(v.updatedAt),
  };
}

export async function createConversation(title: string, mode: string, documentIds: string[]): Promise<ConvRow> {
  const db = await getDb();
  const id = newId();
  const now = nowIso();
  await db.collection("conversations").doc(id).set({
    title: cleanPgText(title),
    mode,
    documentIds: [...documentIds],
    createdAt: now,
    updatedAt: now,
  });
  return { id, title, mode, documentIds: [...documentIds], createdAt: new Date(now), updatedAt: new Date(now) };
}

export async function touchConversation(id: string) {
  const db = await getDb();
  await db.collection("conversations").doc(id).set({ updatedAt: nowIso() }, { merge: true });
}

export async function getMessage(conversationId: string, messageId: string): Promise<MsgRow | null> {
  const db = await getDb();
  const snap = await db
    .collection("conversations")
    .doc(conversationId)
    .collection("messages")
    .doc(messageId)
    .get();
  if (!snap.exists) return null;
  const v = snap.data()!;
  return {
    id: snap.id,
    conversationId,
    role: (v.role as string) || "assistant",
    content: (v.content as string) || "",
    status: (v.status as string) || "complete",
    coverage: (v.coverage as string | null) ?? null,
    coverageNote: (v.coverageNote as string | null) ?? null,
    activityJson: (v.activity as AgentActivity[]) || [],
    createdAt: toDate(v.createdAt),
  };
}

export async function countMessages(conversationId: string): Promise<number> {
  const db = await getDb();
  const snap = await db
    .collection("conversations")
    .doc(conversationId)
    .collection("messages")
    .count()
    .get();
  return snap.data().count;
}

export async function listConversations(): Promise<ConvRow[]> {
  const db = await getDb();
  const snap = await db.collection("conversations").orderBy("updatedAt", "desc").get();
  return snap.docs.map((d) => ({
    id: d.id,
    title: (d.data().title as string) || "Untitled",
    mode: (d.data().mode as string) || "single",
    documentIds: (d.data().documentIds as string[]) || [],
    createdAt: toDate(d.data().createdAt),
    updatedAt: toDate(d.data().updatedAt),
  }));
}

export async function findConversationForDocs(documentIds: string[], mode: string): Promise<ConvRow | null> {
  const db = await getDb();
  const wanted = [...new Set(documentIds)].sort();
  const snap = await db.collection("conversations").where("mode", "==", mode).get();
  for (const d of snap.docs) {
    const ids = [...new Set(((d.data().documentIds as string[]) || []))].sort();
    if (ids.join(",") === wanted.join(",")) {
      return {
        id: d.id,
        title: (d.data().title as string) || "Untitled",
        mode,
        documentIds: ids,
        createdAt: toDate(d.data().createdAt),
        updatedAt: toDate(d.data().updatedAt),
      };
    }
  }
  return null;
}

export async function latestConversationForDoc(documentId: string): Promise<ConvRow | null> {
  const db = await getDb();
  const snap = await db
    .collection("conversations")
    .where("mode", "==", "single")
    .where("documentIds", "array-contains", documentId)
    .orderBy("updatedAt", "desc")
    .limit(1)
    .get();
  if (snap.empty) return null;
  const d = snap.docs[0]!;
  return {
    id: d.id,
    title: (d.data().title as string) || "Untitled",
    mode: "single",
    documentIds: (d.data().documentIds as string[]) || [],
    createdAt: toDate(d.data().createdAt),
    updatedAt: toDate(d.data().updatedAt),
  };
}

export async function addMessage(input: {
  conversationId: string;
  role: string;
  content: string;
  status?: string;
}): Promise<MsgRow> {
  const db = await getDb();
  const id = newId();
  const now = nowIso();
  const data = {
    role: input.role,
    content: cleanPgText(input.content),
    status: input.status || "complete",
    coverage: null,
    coverageNote: null,
    activity: [],
    createdAt: now,
  };
  await db.collection("conversations").doc(input.conversationId).collection("messages").doc(id).set(data);
  return {
    id,
    conversationId: input.conversationId,
    role: input.role,
    content: data.content,
    status: data.status,
    coverage: null,
    coverageNote: null,
    activityJson: [],
    createdAt: new Date(now),
  };
}

export async function updateMessage(
  id: string,
  conversationId: string,
  patch: Partial<Record<string, unknown>>,
): Promise<MsgRow> {
  const db = await getDb();
  const ref = db.collection("conversations").doc(conversationId).collection("messages").doc(id);
  await ref.set(cleanJson({ ...patch }), { merge: true });
  const snap = await ref.get();
  const v = snap.data()!;
  return {
    id,
    conversationId,
    role: (v.role as string) || "assistant",
    content: (v.content as string) || "",
    status: (v.status as string) || "complete",
    coverage: (v.coverage as string | null) ?? null,
    coverageNote: (v.coverageNote as string | null) ?? null,
    activityJson: (v.activity as AgentActivity[]) || [],
    createdAt: toDate(v.createdAt),
  };
}

export async function listMessages(conversationId: string): Promise<MsgRow[]> {
  const db = await getDb();
  const snap = await db
    .collection("conversations")
    .doc(conversationId)
    .collection("messages")
    .orderBy("createdAt")
    .get();
  return snap.docs.map((d) => {
    const v = d.data();
    return {
      id: d.id,
      conversationId,
      role: (v.role as string) || "user",
      content: (v.content as string) || "",
      status: (v.status as string) || "complete",
      coverage: (v.coverage as string | null) ?? null,
      coverageNote: (v.coverageNote as string | null) ?? null,
      activityJson: (v.activity as AgentActivity[]) || [],
      createdAt: toDate(v.createdAt),
    };
  });
}

export async function addCitations(
  conversationId: string,
  messageId: string,
  cites: Array<{
    documentId: string;
    quoteText: string;
    verified: boolean;
    displayText: string | null;
    pageNumber: number | null;
    pageEnd: number | null;
    charStart: number | null;
    charEnd: number | null;
    occurrence: number;
    totalOccurrences: number;
    omitted: boolean;
  }>,
) {
  const db = await getDb();
  const col = db.collection("conversations").doc(conversationId).collection("messages").doc(messageId).collection("citations");
  let batch = db.batch();
  let n = 0;
  for (const c of cites) {
    batch.set(col.doc(newId()), {
      documentId: c.documentId,
      quoteText: cleanPgText(c.quoteText),
      verified: c.verified,
      displayText: c.displayText ? cleanPgText(c.displayText) : null,
      pageNumber: c.pageNumber,
      pageEnd: c.pageEnd,
      charStart: c.charStart,
      charEnd: c.charEnd,
      occurrence: c.occurrence,
      totalOccurrences: c.totalOccurrences,
      omitted: c.omitted,
    });
    n += 1;
    if (n >= 400) {
      await batch.commit();
      batch = db.batch();
      n = 0;
    }
  }
  if (n > 0) await batch.commit();
}

export async function listCitations(conversationId: string, messageIds: string[]): Promise<CiteRow[]> {
  if (!messageIds.length) return [];
  const db = await getDb();
  const out: CiteRow[] = [];
  for (const mid of messageIds) {
    const snap = await db
      .collection("conversations")
      .doc(conversationId)
      .collection("messages")
      .doc(mid)
      .collection("citations")
      .get();
    for (const d of snap.docs) {
      const v = d.data();
      out.push({
        id: d.id,
        messageId: mid,
        documentId: (v.documentId as string) || "",
        quoteText: (v.quoteText as string) || "",
        verified: Boolean(v.verified),
        displayText: (v.displayText as string | null) ?? null,
        pageNumber: (v.pageNumber as number | null) ?? null,
        pageEnd: (v.pageEnd as number | null) ?? null,
        charStart: (v.charStart as number | null) ?? null,
        charEnd: (v.charEnd as number | null) ?? null,
        occurrence: (v.occurrence as number) || 0,
        totalOccurrences: (v.totalOccurrences as number) || 0,
        omitted: Boolean(v.omitted),
      });
    }
  }
  return out;
}

export async function deleteConversationCascade(id: string) {
  const db = await getDb();
  const ref = db.collection("conversations").doc(id);
  const msgs = await ref.collection("messages").listDocuments();
  for (const m of msgs) {
    await deleteCollection(db, m.collection("citations"));
    await m.delete().catch(() => undefined);
  }
  await ref.delete().catch(() => undefined);
}

// ---------- comparisons ----------

export async function createComparison(leftId: string, rightId: string, summary: string): Promise<CmpRow> {
  const db = await getDb();
  const id = newId();
  const now = nowIso();
  await db.collection("comparisons").doc(id).set({
    leftDocumentId: leftId,
    rightDocumentId: rightId,
    summary: cleanPgText(summary),
    createdAt: now,
  });
  return { id, leftDocumentId: leftId, rightDocumentId: rightId, summary, createdAt: new Date(now) };
}

export async function addComparisonChanges(
  comparisonId: string,
  changes: Array<{
    changeType: string;
    significance: string;
    significanceScore: number;
    title: string;
    explanation: string;
    leftText: string | null;
    rightText: string | null;
    leftPage: number | null;
    rightPage: number | null;
    sortOrder: number;
  }>,
): Promise<ChangeRow[]> {
  const db = await getDb();
  const col = db.collection("comparisons").doc(comparisonId).collection("changes");
  const rows: ChangeRow[] = changes.map((c) => ({
    id: newId(),
    comparisonId,
    changeType: c.changeType,
    significance: c.significance,
    significanceScore: c.significanceScore,
    title: cleanPgText(c.title),
    explanation: cleanPgText(c.explanation),
    leftText: c.leftText ? cleanPgText(c.leftText) : null,
    rightText: c.rightText ? cleanPgText(c.rightText) : null,
    leftPage: c.leftPage,
    rightPage: c.rightPage,
    sortOrder: c.sortOrder,
  }));
  let batch = db.batch();
  let n = 0;
  for (const r of rows) {
    const { id, ...rest } = r;
    batch.set(col.doc(id), rest);
    n += 1;
    if (n >= 400) {
      await batch.commit();
      batch = db.batch();
      n = 0;
    }
  }
  if (n > 0) await batch.commit();
  return rows;
}
