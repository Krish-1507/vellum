import { getDb } from "@/lib/firestore";
import { aiConfigured, getAiConfig } from "@/lib/ai";

export const dynamic = "force-dynamic";

export async function GET() {
  let database: "up" | "missing" | "down" = "up";
  let dbMessage: string | null = null;
  try {
    const db = await getDb();
    await db.collection("documents").limit(1).get();
  } catch (err) {
    database = "down";
    dbMessage =
      err instanceof Error
        ? err.message
        : "Could not reach Firestore. Set FIRESTORE_EMULATOR_HOST for local dev or FIREBASE_PROJECT_ID in production.";
  }

  const ai = aiConfigured();
  const { model, baseUrl } = getAiConfig();
  const ok = database === "up";
  return Response.json(
    {
      ok,
      database,
      dbMessage,
      ai: ai ? "configured" : "missing",
      aiMessage: ai ? null : "No AI key found. Set GROQ_API_KEY in .env.",
      model,
      baseUrl,
    },
    { status: ok ? 200 : 503 },
  );
}
