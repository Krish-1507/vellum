export async function readSse(
  res: Response,
  handlers: {
    onEvent: (event: string, data: unknown) => void;
    signal?: AbortSignal;
  },
) {
  if (!res.body) throw new Error("No response body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const abort = () => {
    reader.cancel().catch(() => undefined);
  };
  handlers.signal?.addEventListener("abort", abort);

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";
      for (const part of parts) {
        let event = "message";
        const dataLines: string[] = [];
        for (const line of part.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
        }
        const raw = dataLines.join("\n");
        if (!raw) continue;
        let data: unknown = raw;
        try {
          data = JSON.parse(raw);
        } catch {
          // keep raw
        }
        handlers.onEvent(event, data);
      }
    }
  } finally {
    handlers.signal?.removeEventListener("abort", abort);
  }
}
