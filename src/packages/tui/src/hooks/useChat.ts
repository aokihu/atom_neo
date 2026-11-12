import { useRef, useCallback, useEffect } from "react";
import { useChatStore } from "../stores/chat";
import type { Message, ToolInfo, MCPServerInfo } from "../types";
import { connectChat, submitChatMessage } from "./chat-connection";
import type { ChatConnection } from "./chat-connection";
import { resolveChatClientError } from "./chat-errors";
import type { ChatClientError } from "./chat-errors";

export { resolveChatClientError };
export type { ChatClientError };

export function useChat(
  url: string,
  sessionId?: string,
  initialToolInfos?: ToolInfo[],
  initialMCPServers?: MCPServerInfo[],
  onClientError?: (error: ChatClientError) => void,
) {
  const connectionRef = useRef<ChatConnection | null>(null);

  useEffect(() => {
    const connection = connectChat({
      url,
      sessionId,
      initialToolInfos,
      initialMCPServers,
    });
    connectionRef.current = connection;
    return () => {
      connection.close();
      if (connectionRef.current === connection) connectionRef.current = null;
    };
  }, [url, sessionId]);

  const send = useCallback(async (text: string) => {
    const connection = connectionRef.current;
    if (connection) await connection.send(text, onClientError);
    else await submitChatMessage(null, text, onClientError);
  }, [onClientError]);

  const clearMessages = useCallback(() => {
    useChatStore.getState().clearMessages();
  }, []);

  const addMessage = useCallback((msg: Message) => {
    useChatStore.getState().addMessage(msg);
  }, []);

  const compact = useCallback(() => {
    connectionRef.current?.compact();
  }, []);

  const cancel = useCallback(() => {
    return connectionRef.current?.cancel() ?? false;
  }, []);

  return { send, clearMessages, addMessage, compact, cancel };
}
