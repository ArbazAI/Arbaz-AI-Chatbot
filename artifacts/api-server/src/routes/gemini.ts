import { GoogleGenAI } from "@google/genai";
import { Router, type IRouter } from "express";

type ChatRole = "user" | "assistant";

interface ChatMessage {
  role: ChatRole;
  content: string;
}

const router: IRouter = Router();
const rateWindowMs = 60_000;
const maxRequestsPerWindow = 12;
const requestCounts = new Map<string, { count: number; startedAt: number }>();

const systemInstruction = `You are "Arbaz AI", a smart, versatile, and highly intelligent AI assistant.
You were created by Arbaz Khan on October 22, 2026.
When asked "Who created you?" or "Who is your creator?", always proudly answer that you were built and created by Arbaz Khan.
When asked "When were you created?", answer that you were created on October 22, 2026.
When asked "What did your master first tell you?", answer exactly: "I was created by Arbaz Khan on October 22, 2026, and my master's first instruction to me was to be a smart, loyal, and helpful AI assistant for his tech projects and studies."
You excel in math problem solving, general science, web coding (HTML/CSS/JavaScript/Python), writing scripts, and answering technical questions accurately in Hindi, Hinglish, and English.
Reply in the language the user is using. Be accurate, clear, and helpful. Put code in fenced blocks with a suitable language label.`;

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;

  const message = value as Record<string, unknown>;
  return (
    (message.role === "user" || message.role === "assistant") &&
    typeof message.content === "string" &&
    message.content.trim().length > 0 &&
    message.content.length <= 12_000
  );
}

function getRateLimitError(clientId: string): number | null {
  const now = Date.now();
  const current = requestCounts.get(clientId);

  if (!current || now - current.startedAt >= rateWindowMs) {
    requestCounts.set(clientId, { count: 1, startedAt: now });
    if (requestCounts.size > 1_000) {
      for (const [key, value] of requestCounts) {
        if (now - value.startedAt >= rateWindowMs) requestCounts.delete(key);
      }
    }
    return null;
  }

  if (current.count >= maxRequestsPerWindow) {
    return Math.max(1, Math.ceil((rateWindowMs - (now - current.startedAt)) / 1_000));
  }

  current.count += 1;
  return null;
}

router.post("/gemini/chat", async (req, res) => {
  const body = req.body as unknown;
  if (!body || typeof body !== "object" || !("messages" in body)) {
    res.status(400).json({ error: "Send at least one user message." });
    return;
  }

  const rawMessages = (body as { messages: unknown }).messages;
  if (
    !Array.isArray(rawMessages) ||
    rawMessages.length < 1 ||
    rawMessages.length > 40 ||
    !rawMessages.every(isChatMessage) ||
    rawMessages[rawMessages.length - 1]?.role !== "user"
  ) {
    res.status(400).json({ error: "The chat history is invalid or too long." });
    return;
  }

  const clientId = req.ip || req.socket.remoteAddress || "unknown";
  const retryAfter = getRateLimitError(clientId);
  if (retryAfter !== null) {
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({ error: "Too many requests. Please wait a moment and try again." });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(503).json({
      error: "Gemini is not connected yet. Add a rotated GEMINI_API_KEY in Replit Secrets to enable chat.",
    });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  try {
    const ai = new GoogleGenAI({ apiKey });
    const stream = await ai.models.generateContentStream({
      model: "gemini-3.8-flash",
      contents: rawMessages.map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      })),
      config: {
        systemInstruction,
        maxOutputTokens: 8192,
      },
    });

    for await (const chunk of stream) {
      if (res.destroyed) break;
      const content = chunk.text;
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    if (!res.destroyed) {
      res.write("data: [DONE]\n\n");
      res.end();
    }
  } catch (error: unknown) {
    const details =
      error && typeof error === "object"
        ? (error as Record<string, unknown>)
        : {};
    const rawMessage = typeof details.message === "string" ? details.message : "";
    const safeMessage = rawMessage
      .replace(/([?&](?:key|api[_-]?key)=)[^&\s]+/gi, "$1[redacted]")
      .replace(/\b[A-Za-z0-9._-]{28,}\b/g, "[redacted]")
      .slice(0, 400);
    req.log.error(
      {
        errorName: typeof details.name === "string" ? details.name : "UnknownError",
        status:
          typeof details.status === "number"
            ? details.status
            : typeof details.statusCode === "number"
              ? details.statusCode
              : undefined,
        code: typeof details.code === "string" ? details.code : undefined,
        message: safeMessage,
      },
      "Gemini response generation failed",
    );
    if (!res.destroyed) {
      res.write(`data: ${JSON.stringify({ error: "Gemini could not finish the response. Please try again." })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    }
  }
});

export default router;
