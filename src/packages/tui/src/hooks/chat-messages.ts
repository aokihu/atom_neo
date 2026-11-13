import { useChatStore } from "../stores/chat";
import type { Message } from "../types";
import { resolveChatClientError } from "./chat-errors";
import type { ChatClientError } from "./chat-errors";
import type { ChatConnectionClient } from "./chat-connection";

export type ChatSnapshotMessage = {
  role: string;
  content: string;
  timestamp: number;
  seq?: number;
  visible?: boolean;
};

export function mapChatSnapshot(sessionId: string, messages: ChatSnapshotMessage[]): Message[] {
  return messages
    .filter(m => m.visible !== false && (m.role === "user" || m.role === "assistant"))
    .map(m => ({
      id: `${sessionId}-${m.seq ?? m.timestamp}`,
      role: m.role as "user" | "assistant",
      content: m.content,
      timestamp: m.timestamp,
      streaming: false,
    }));
}

export async function submitChatMessage(
  client: ChatConnectionClient | null,
  text: string,
  onClientError?: (error: ChatClientError) => void,
): Promise<void> {
  const store = useChatStore.getState();
  store.prepareForSend();
  store.addMessage({ role: "user", content: text, id: store.generateId(), timestamp: Date.now() });

  try {
    if (!client) throw new Error("Not connected");
    await client.send(text);
  } catch (err: any) {
    const cancelled = err?.name === "TaskCancelledError";
    const clientError = resolveChatClientError(err);
    if (clientError && onClientError) {
      onClientError(clientError);
      return;
    }
    const message = {
      role: cancelled ? "info" as const : "error" as const,
      content: cancelled ? "Task cancelled by user" : err.message,
      id: useChatStore.getState().generateId(),
      timestamp: Date.now(),
    };
    if (cancelled) useChatStore.getState().addTransientMessage(message, 2_000);
    else useChatStore.getState().addMessage(message);
  }
}
