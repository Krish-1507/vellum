import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  conversationDocuments,
  conversations,
  documentChunks,
  documentPages,
  documents,
  messageCitations,
  messages,
  type DocumentRow,
} from "@/db/schema";
import type { AgentActivity } from "@/lib/types";
import { aiConfigured } from "@/lib/ai";
import { cleanJson, cleanPgText } from "@/lib/pgtext";
import { runAgent, type LoadedDoc } from "@/lib/agent";
import { serializeMessage } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function sse(encoder: TextEncoder, event: string, data: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function POST(req: Request) {
  if (!aiConfigured()) {
    return Response.json(
      {
        error:
          "No AI key configured. Set GROQ_API_KEY (recommended) or AI_API_KEY, plus optional AI_BASE_URL and AI_MODEL.",
      },
      { status: 503 },
    );
  }

  const body = (await req.json()) as {
    documentIds?: string[];
    conversationId?: string;
    message?: string;
  };
  const documentIds = [...new Set(body.documentIds || [])];
  const question = (body.message || "").trim();
  if (!documentIds.length) {
    return Response.json({ error: "Select at least one document." }, { status: 400 });
  }
  if (!question) {
    return Response.json({ error: "Ask a question." }, { status: 400 });
  }

  const docsRows = await db.select().from(documents).where(inArray(documents.id, documentIds));
  if (docsRows.length !== documentIds.length) {
    return Response.json({ error: "One of the documents is missing." }, { status: 404 });
  }
  const notReady = docsRows.filter((d) => d.status !== "ready");
  if (notReady.length) {
    return Response.json(
      { error: `“${notReady[0]!.name}” is not ready to query yet.` },
      { status: 409 },
    );
  }

  const loaded = await loadDocs(docsRows);
  const mode = docsRows.length > 1 ? "multi" : "single";
  let conversationId = body.conversationId || "";

  if (conversationId) {
    const [existing] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);
    if (!existing) conversationId = "";
  }

  if (!conversationId) {
    const title = cleanPgText(question.slice(0, 72));
    const [conv] = await db
      .insert(conversations)
      .values({ title, mode })
      .returning();
    conversationId = conv!.id;
    await db.insert(conversationDocuments).values(
      documentIds.map((documentId) => ({ conversationId, documentId })),
    );
  }

  const [userMsg] = await db
    .insert(messages)
    .values({
      conversationId,
      role: "user",
      content: cleanPgText(question),
      status: "complete",
    })
    .returning();

  const [assistantMsg] = await db
    .insert(messages)
    .values({
      conversationId,
      role: "assistant",
      content: "",
      status: "streaming",
      activityJson: [],
    })
    .returning();

  const historyRows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId));
  const history = historyRows
    .filter((m) => m.id !== assistantMsg!.id && m.id !== userMsg!.id)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .filter((m) => Boolean(m.content))
    .slice(-8)
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  const encoder = new TextEncoder();
  const abort = req.signal;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(sse(encoder, event, data));
      };
      send("meta", {
        conversationId,
        userMessage: serializeMessage(userMsg!, []),
        assistantId: assistantMsg!.id,
      });

      let answer = "";
      const activity: AgentActivity[] = [];
      try {
        const result = await runAgent({
          docs: loaded,
          question,
          history,
          signal: abort,
          onStatus: async (item) => {
            activity.push(item);
            send("status", item);
            await db
              .update(messages)
              .set({ activityJson: cleanJson(activity) })
              .where(eq(messages.id, assistantMsg!.id));
          },
          onToken: async (token) => {
            answer += token;
            send("token", { text: token });
          },
        });

        const stopped = abort.aborted;
        const content = result.answer || answer;
        const status = stopped ? "stopped" : "complete";

        if (result.quotes.length) {
          await db.insert(messageCitations).values(
            result.quotes.map((q) => ({
              messageId: assistantMsg!.id,
              documentId: q.documentId,
              quoteText: cleanPgText(q.quoteText),
              verified: q.verified,
              displayText: q.displayText ? cleanPgText(q.displayText) : q.displayText,
              pageNumber: q.pageNumber,
              pageEnd: q.pageEnd,
              charStart: q.charStart,
              charEnd: q.charEnd,
              occurrence: q.occurrence,
              totalOccurrences: q.totalOccurrences,
              omitted: q.omitted,
            })),
          );
        }

        const [saved] = await db
          .update(messages)
          .set({
            content: cleanPgText(content),
            status,
            coverage: result.coverage,
            coverageNote: result.coverageNote ? cleanPgText(result.coverageNote) : result.coverageNote,
            activityJson: cleanJson(result.activity),
          })
          .where(eq(messages.id, assistantMsg!.id))
          .returning();

        await db
          .update(conversations)
          .set({ updatedAt: new Date() })
          .where(eq(conversations.id, conversationId));

        const cites = await db
          .select()
          .from(messageCitations)
          .where(eq(messageCitations.messageId, assistantMsg!.id));

        send("done", {
          message: serializeMessage(saved!, cites),
          droppedUnverified: result.droppedUnverified,
        });
      } catch (err) {
        if (abort.aborted) {
          const [saved] = await db
            .update(messages)
            .set({ content: cleanPgText(answer), status: "stopped", activityJson: cleanJson(activity) })
            .where(eq(messages.id, assistantMsg!.id))
            .returning();
          send("done", { message: serializeMessage(saved!, []), droppedUnverified: 0 });
        } else {
          const message = err instanceof Error ? err.message : "The model failed.";
          await db
            .update(messages)
            .set({
              content: cleanPgText(answer || message),
              status: "error",
              activityJson: cleanJson(activity),
            })
            .where(eq(messages.id, assistantMsg!.id));
          send("error", { message });
        }
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

async function loadDocs(rows: DocumentRow[]): Promise<LoadedDoc[]> {
  const ids = rows.map((r) => r.id);
  const chunks = await db.select().from(documentChunks).where(inArray(documentChunks.documentId, ids));
  const pages = await db.select().from(documentPages).where(inArray(documentPages.documentId, ids));
  return rows.map((document) => ({
    document,
    chunks: chunks.filter((c) => c.documentId === document.id),
    pages: pages.filter((p) => p.documentId === document.id),
  }));
}
