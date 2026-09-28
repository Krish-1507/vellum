import {
  addCitations,
  addMessage,
  createConversation,
  getConversation,
  getDocumentFull,
  listChunks,
  listCitations,
  listMessages,
  listPages,
  touchConversation,
  updateMessage,
  type ChunkRow,
  type DocRow,
  type PageRow,
} from "@/lib/store";
import type { AgentActivity } from "@/lib/types";
import { aiConfigured } from "@/lib/ai";
import { mergeEntities } from "@/lib/anon";
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
  if (documentIds.length > 10) {
    return Response.json({ error: "Select up to 10 documents at once." }, { status: 400 });
  }

  const fulls = await Promise.all(documentIds.map((id) => getDocumentFull(id)));
  if (fulls.some((f) => !f)) {
    return Response.json({ error: "One of the documents is missing." }, { status: 404 });
  }
  const notReady = fulls.filter((f) => f!.doc.status !== "ready");
  if (notReady.length) {
    return Response.json(
      { error: `“${notReady[0]!.doc.name}” is not ready to query yet.` },
      { status: 409 },
    );
  }

  const loaded: LoadedDoc[] = await Promise.all(
    fulls.map(async (f) => {
      const doc = f!.doc;
      const [chunks, pages] = await Promise.all([listChunks(doc.id), listPages(doc.id)]);
      return {
        document: { ...doc, extractedText: f!.text },
        chunks,
        pages,
      };
    }),
  );
  const mode = documentIds.length > 1 ? "multi" : "single";
  let conversationId = body.conversationId || "";

  if (conversationId) {
    const existing = await getConversation(conversationId);
    if (!existing) conversationId = "";
  }

  if (!conversationId) {
    const title = question.slice(0, 72);
    const conv = await createConversation(title, mode, documentIds);
    conversationId = conv.id;
  }

  const userMsg = await addMessage({ conversationId, role: "user", content: question });
  const assistantMsg = await addMessage({
    conversationId,
    role: "assistant",
    content: "",
    status: "streaming",
  });

  const historyRows = await listMessages(conversationId);
  const history = historyRows
    .filter((m) => m.id !== assistantMsg.id && m.id !== userMsg.id)
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
        userMessage: serializeMessage(userMsg, []),
        assistantId: assistantMsg.id,
      });

      let answer = "";
      const activity: AgentActivity[] = [];
      // Entities are known before streaming starts, so the live token stream
      // can be masked too — not just the final payload. The masker holds
      // back anything that could still be an unfinished match, so entities
      // split across token boundaries are still caught. The full original
      // is what gets stored (reversible via the toggle).
      const streamEntities = mergeEntities(
        loaded.filter((l) => l.document.anonymized).map((l) => l.document.entitiesJson),
      );
      const { createStreamMasker } = await import("@/lib/anon");
      const masker = createStreamMasker(streamEntities);
      const sendMasked = (text: string) => {
        const out = masker.push(text);
        if (out) send("token", { text: out });
      };
      const flushMasked = () => {
        const out = masker.flush();
        if (out) send("token", { text: out });
      };
      try {
        const deadlineMs = Math.max(
          15000,
          Number(process.env.AGENT_DEADLINE_MS || "55000"),
        );
        const result = await runAgent({
          docs: loaded,
          question,
          history,
          signal: abort,
          deadlineMs,
          onStatus: async (item) => {
            activity.push(item);
            send("status", item);
            await updateMessage(assistantMsg.id, conversationId, { activityJson: activity });
          },
          onToken: async (token) => {
            answer += token;
            sendMasked(token);
          },
        });
        flushMasked();

        const stopped = abort.aborted;
        const content = result.answer || answer;
        const status = stopped ? "stopped" : "complete";

        if (result.quotes.length) {
          await addCitations(conversationId, assistantMsg.id, result.quotes);
        }

        await updateMessage(assistantMsg.id, conversationId, {
          content,
          status,
          coverage: result.coverage,
          coverageNote: result.coverageNote,
          activityJson: result.activity,
        });
        await touchConversation(conversationId);

        const cites = await listCitations(conversationId, [assistantMsg.id]);
        const saved = await updateMessage(assistantMsg.id, conversationId, {});

        send("done", {
          message: serializeMessage(saved!, cites, streamEntities),
          droppedUnverified: result.droppedUnverified,
        });
      } catch (err) {
        if (abort.aborted) {
          const saved = await updateMessage(assistantMsg.id, conversationId, {
            content: answer,
            status: "stopped",
            activityJson: activity,
          });
          send("done", { message: serializeMessage(saved, [], streamEntities), droppedUnverified: 0 });
        } else {
          const message = err instanceof Error ? err.message : "The model failed.";
          await updateMessage(assistantMsg.id, conversationId, {
            content: answer || message,
            status: "error",
            activityJson: activity,
          });
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
