import { createContext, useContext, useMemo, useEffect, useCallback } from "react";
import { useTerminalDimensions } from "@opentui/react";
import "opentui-spinner/react";
import { useChat } from "../hooks/useChat";
import { getTheme } from "../theme";
import type { ServerInfo, ThemeColors } from "../types";
import { SyntaxStyle } from "@opentui/core";
import { StatusBar } from "./StatusBar";
import { StatusLine } from "./StatusLine";
import { ChatView } from "./ChatView";
import { InputBar } from "./InputBar";
import { Sidebar } from "./Sidebar";
import type { Message } from "../types";
import { useInputHistory } from "../stores/inputHistory";

const SIDEBAR_MIN_WIDTH = 90;
const FALLBACK_CONTEXT_LIMIT = 131_072;

type ThemeCtx = { colors: ThemeColors; syntaxStyle: SyntaxStyle };

const ThemeContext = createContext<ThemeCtx>(getTheme());

export function useTheme() { return useContext(ThemeContext); }

function isProcessing(msgs: Message[]): boolean {
  return msgs.some(m =>
    m.role === "tool-group" && !m.collapsed &&
    m.entries.some(e => e.phase === "executing" || e.phase === "preparing")
  );
}

const HELP_TEXT = `Available commands:
  /quit   Exit Atom Neo
  /help   Show this help message
  /clear  Clear chat history

Keyboard shortcuts:
  Ctrl+C      Exit (press twice)
  Up/Down     Navigate input history
  /           Open command menu
  Tab         Autocomplete command
  Esc         Dismiss command menu
  Shift+Enter New line`;

export function App({ url, serverInfo, onQuit, exitHint }: { url: string; serverInfo: ServerInfo; onQuit?: () => void; exitHint?: string | null }) {
  const { width } = useTerminalDimensions();
  const { messages, send, clearMessages, addMessage, tokenUsage, sessionBusy, todoItems, thinkingVisible } = useChat(url);
  const theme = useMemo(() => getTheme(serverInfo.theme), [serverInfo.theme]);
  const showSidebar = width >= SIDEBAR_MIN_WIDTH;
  const contextLimit = serverInfo.contextLimit ?? FALLBACK_CONTEXT_LIMIT;

  useEffect(() => { useInputHistory.getState().init(serverInfo.sandbox); }, [serverInfo.sandbox]);

  const nextIdRef = useCallback(() => `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, []);

  const handleHelp = useCallback(() => {
    addMessage({ role: "info", content: HELP_TEXT, id: nextIdRef(), timestamp: Date.now() });
  }, [addMessage, nextIdRef]);

  const handleClear = useCallback(() => {
    clearMessages();
  }, [clearMessages]);

  return (
    <ThemeContext.Provider value={theme}>
      <box flexDirection="column" width="100%" height="100%" backgroundColor={theme.colors.bg.page}>
        <StatusBar serverInfo={serverInfo} />
        <box flexDirection="row" flexGrow={1}>
          <box flexGrow={1} flexDirection="column" overflow="hidden" border={showSidebar ? ['right'] : false} borderColor={theme.colors.border.default} borderStyle="single">
            <ChatView messages={messages} thinkingVisible={thinkingVisible} />
            <InputBar onSend={send} onQuit={onQuit} onHelp={handleHelp} onClear={handleClear} sessionBusy={sessionBusy} />
            <StatusLine hint={exitHint} processing={sessionBusy || isProcessing(messages)} />
          </box>
          {showSidebar && <Sidebar serverInfo={serverInfo} tokenUsage={tokenUsage} contextLimit={contextLimit} todoItems={todoItems} />}
        </box>
      </box>
    </ThemeContext.Provider>
  );
}
