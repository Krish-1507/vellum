export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
};

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ToolDef = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export function getAiConfig() {
  const groqKey = process.env.GROQ_API_KEY || "";
  const genericKey =
    process.env.AI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    "";
  // Prefer an explicitly set generic key; otherwise fall back to Groq.
  const apiKey = genericKey || groqKey;
  const usingGroq = Boolean(!genericKey && groqKey);

  const baseUrl = (
    process.env.AI_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    process.env.OPENROUTER_BASE_URL ||
    (usingGroq ? "https://api.groq.com/openai/v1" : "https://api.openai.com/v1")
  ).replace(/\/$/, "");
  // openai/gpt-oss-120b: OpenAI's open-weight flagship on Groq — 131k context,
  // native tool use (needed for the agentic loop), 500 tok/s, $0.15/$0.60
  // per 1M tokens, generous free-tier limits. Override with AI_MODEL if needed.
  // (llama-3.3-70b-versatile has moved to Groq enterprise-only and 404s on
  // free keys — do not default back to it.)
  const model =
    process.env.AI_MODEL ||
    process.env.OPENAI_MODEL ||
    process.env.OPENROUTER_MODEL ||
    (usingGroq ? "openai/gpt-oss-120b" : "gpt-4o-mini");
  return { apiKey, baseUrl, model, provider: usingGroq ? "groq" : "openai-compatible" as const };
}

export function aiConfigured() {
  return Boolean(getAiConfig().apiKey);
}

// A Groq key pointed at OpenAI's API (or vice versa) can never work.
// Fail fast with a plain message instead of a cryptic 401 from the provider.
export function assertSaneConfig() {
  const { apiKey, baseUrl } = getAiConfig();
  const looksGroqKey = apiKey.startsWith("gsk_");
  const isOpenAiBase = baseUrl.includes("api.openai.com");
  const isGroqBase = baseUrl.includes("api.groq.com");
  if (looksGroqKey && isOpenAiBase) {
    throw new Error(
      "GROQ_API_KEY is set but AI_BASE_URL points at OpenAI. Comment out AI_BASE_URL (and AI_MODEL) in .env so the Groq defaults apply.",
    );
  }
  if (!looksGroqKey && isGroqBase && !apiKey.startsWith("gsk_")) {
    throw new Error(
      "AI_BASE_URL points at Groq but the API key is not a Groq key. Set GROQ_API_KEY in .env.",
    );
  }
}

function headers() {
  const { apiKey } = getAiConfig();
  const h: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (process.env.OPENROUTER_API_KEY || (process.env.AI_BASE_URL || "").includes("openrouter")) {
    h["HTTP-Referer"] = process.env.OPENROUTER_SITE_URL || "http://localhost:3000";
    h["X-Title"] = "Vellum Contract Desk";
  }
  return h;
}

export async function chatComplete(opts: {
  messages: ChatMessage[];
  tools?: ToolDef[];
  temperature?: number;
  signal?: AbortSignal;
}): Promise<{ content: string; toolCalls: ToolCall[] }> {
  const { model, baseUrl, apiKey } = getAiConfig();
  if (!apiKey) {
    throw new Error("NO_AI_KEY");
  }
  assertSaneConfig();

  const body: Record<string, unknown> = {
    model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.15,
    // Cap output length so one answer can never burn through a free-tier
    // allowance. 2048 tokens is plenty for a contract answer + citations.
    max_tokens: 2048,
  };
  if (opts.tools?.length) {
    body.tools = opts.tools;
    body.tool_choice = "auto";
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`AI request failed (${res.status}): ${text.slice(0, 400)}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: ToolCall[];
      };
    }>;
  };
  const message = json.choices?.[0]?.message;
  return {
    content: message?.content || "",
    toolCalls: message?.tool_calls || [],
  };
}

export async function chatStream(opts: {
  messages: ChatMessage[];
  temperature?: number;
  signal?: AbortSignal;
  onToken: (token: string) => void;
}): Promise<string> {
  const { model, baseUrl, apiKey } = getAiConfig();
  if (!apiKey) {
    throw new Error("NO_AI_KEY");
  }
  assertSaneConfig();

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.15,
      max_tokens: 2048,
      stream: true,
    }),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`AI stream failed (${res.status}): ${text.slice(0, 400)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const json = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const token = json.choices?.[0]?.delta?.content || "";
        if (token) {
          full += token;
          opts.onToken(token);
        }
      } catch {
        // ignore malformed SSE chunks from the provider
      }
    }
  }

  return full;
}
