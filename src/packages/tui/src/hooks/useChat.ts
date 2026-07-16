import { useRef, useCallback, useEffect } from "react";
import { TuiClient } from "../client/ws-client";
import { useChatStore } from "../stores/chat";
import type { ToolInfo, MCPServerInfo } from "../types";

export function useChat(url: string, sessionId?: string, initialToolInfos?: ToolInfo[], initialMCPServers?: MCPServerInfo[]) {
  const clientRef = useRef<TuiClient | null>(null);
  const reasoningBufferRef = useRef("");
  const activityRef = useRef(false);
  const thinkingStartRef = useRef(0);

  useEffect(() => {
    if (initialToolInfos) useChatStore.setState({ toolInfos: initialToolInfos });
    if (initialMCPServers) useChatStore.setState({ mcpServers: initialMCPServers });

    const client = new TuiClient({ url, sessionId });
    clientRef.current = client;

    client.onTokenUsage((total) => {
      useChatStore.getState().setTokenUsage(total);
    });

    client.onReason((delta) => {
      if (!activityRef.current) {
        activityRef.current = true;
        useChatStore.getState().setShowPreparing(false);
        thinkingStartRef.current = Date.now();
      }
      reasoningBufferRef.current += delta;
    });

    client.onDelta((delta, offset) => {
      const reasoning = reasoningBufferRef.current;
      if (!activityRef.current) {
        activityRef.current = true;
        thinkingStartRef.current = Date.now();
        reasoningBufferRef.current = "";
      } else {
        reasoningBufferRef.current = "";
      }
      const duration = reasoning && thinkingStartRef.current
        ? Math.round((Date.now() - thinkingStartRef.current) / 1000)
        : undefined;
      useChatStore.getState().handleDelta(delta, offset, reasoning || undefined, duration);
    });

    client.onTool((event) => {
      useChatStore.getState().handleToolEvent(event);
    });

    client.onToolStepFinish((event) => {
      useChatStore.getState().handleToolStepFinish(
        event.total, event.success, event.failed, event.toolNames,
      );
    });

    client.onToolGroupComplete((event) => {
      useChatStore.getState().handleToolGroupComplete(
        event.total, event.success, event.failed, event.toolNames,
      );
    });

    client.onBusyChange((busy) => {
      useChatStore.getState().setBusy(busy);
    });

    client.onMCPConnected((data) => {
      useChatStore.getState().updateMCPConnected(data);
    });

    client.onMCPStatus((servers) => {
      useChatStore.getState().updateMCPStatus(servers);
    });

    client.connect().catch(() => {
      useChatStore.getState().addMessage({
        role: "error", content: "Connection failed",
        id: useChatStore.getState().generateId(), timestamp: Date.now(),
      });
    });

    return () => {
      client.close();
      clientRef.current = null;
    };
  }, [url, sessionId]);

  const send = useCallback(async (text: string) => {
    activityRef.current = false;
    thinkingStartRef.current = 0;
    reasoningBufferRef.current = "";
    useChatStore.getState().prepareForSend();

    const id = useChatStore.getState().generateId();
    useChatStore.getState().addMessage({
      role: "user", content: text, id, timestamp: Date.now(),
    });

    try {
      const client = clientRef.current;
      if (!client) throw new Error("Not connected");
      await client.send(text);
    } catch (err: any) {
      const cancelled = err?.name === "TaskCancelledError";
      const message = {
        role: cancelled ? "info" as const : "error" as const,
        content: cancelled ? "Task cancelled by user" : err.message,
        id: useChatStore.getState().generateId(),
        timestamp: Date.now(),
      };
      if (cancelled) useChatStore.getState().addTransientMessage(message, 2_000);
      else useChatStore.getState().addMessage(message);
    }
  }, []);

  const clearMessages = useCallback(() => {
    useChatStore.getState().clearMessages();
  }, []);

  const addMessage = useCallback((msg: import("../types").Message) => {
    useChatStore.getState().addMessage(msg);
  }, []);

  const compact = useCallback(() => {
    clientRef.current?.sendCompact();
  }, []);

  const cancel = useCallback(() => {
    return clientRef.current?.cancelActiveTask() ?? false;
  }, []);

  return { send, clearMessages, addMessage, compact, cancel };
}
