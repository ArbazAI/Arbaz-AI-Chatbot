import { fetch } from "expo/fetch";

export type MessageRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
}

export interface ApiMessage {
  role: MessageRole;
  content: string;
}

let messageCounter = 0;

export function createMessageId(): string {
  messageCounter += 1;
  return `message-${Date.now()}-${messageCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function streamGeminiChat(
  messages: ApiMessage[],
  onChunk: (content: string) => void,
): Promise<void> {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) {
    throw new Error("The app server address is not available. Reopen the app from Replit.");
  }

  const response = await fetch(`https://${domain}/api/gemini/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({ messages }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
    const message =
      payload && typeof payload.error === "string"
        ? payload.error
        : `Gemini request failed (${response.status}). Please try again.`;
    throw new Error(message);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("The server did not return a readable response.");

  const decoder = new TextDecoder();
  let buffer = "";
  let receivedText = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (!data || data === "[DONE]") continue;

      let payload: unknown;
      try {
        payload = JSON.parse(data);
      } catch {
        continue;
      }

      if (!payload || typeof payload !== "object") continue;
      const event = payload as { content?: unknown; error?: unknown };
      if (typeof event.error === "string") throw new Error(event.error);
      if (typeof event.content === "string" && event.content.length > 0) {
        receivedText = true;
        onChunk(event.content);
      }
    }
  }

  if (!receivedText) throw new Error("Gemini returned an empty response. Please try again.");
}

export function getLocalAssistantReply(text: string): string | null {
  const normalized = text.trim().toLocaleLowerCase();

  if (
    /\b(what did your master first tell you|what was your master's first instruction)\b/i.test(
      normalized,
    )
  ) {
    return "I was created by Arbaz Khan on October 22, 2026, and my master's first instruction to me was to be a smart, loyal, and helpful AI assistant for his tech projects and studies.";
  }

  if (/\b(who (?:is|was) your creator|who created you|who built you|who made you)\b/i.test(normalized)) {
    return "I was built and created by Arbaz Khan on October 22, 2026.";
  }

  if (/\b(when were you created|when were you built|what date were you created)\b/i.test(normalized)) {
    return "I was created on October 22, 2026, by Arbaz Khan.";
  }

  if (/\b(shutdown|shut down|power off|turn off)\b.*\b(pc|computer|laptop)\b/i.test(normalized)) {
    return "I did not shut down or control your device. Save any open work, then use your operating system’s power menu if you want to turn it off.";
  }

  if (/\b(open|launch|start)\b.*\b(browser|chrome|firefox|safari|edge)\b/i.test(normalized)) {
    return "I can’t launch apps from this chat, and I haven’t opened anything. Use your device’s browser icon or app switcher to open it.";
  }

  if (/\b(restart|reboot)\b.*\b(pc|computer|laptop)\b/i.test(normalized)) {
    return "I did not restart or control your device. Save your work first, then restart it from your operating system’s power menu if you choose.";
  }

  return null;
}
