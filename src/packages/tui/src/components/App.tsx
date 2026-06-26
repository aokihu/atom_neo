import { createContext, useContext, useMemo, useEffect, useCallback } from "react";
import { useTerminalDimensions } from "@opentui/react";
import "opentui-spinner/react";
import { useChat } from "../hooks/useChat";
import { useChatStore } from "../stores/chat";
import { getTheme } from "../theme";
import type { ServerInfo, ThemeColors, Message } from "../types";
import { SyntaxStyle } from "@opentui/core";
import { StatusBar } from "./StatusBar";
import { StatusLine } from "./StatusLine";
import { ChatView } from "./ChatView";
import { InputBar } from "./InputBar";
import { Sidebar } from "./Sidebar";
import { useInputHistory } from "../stores/inputHistory";

const SIDEBAR_MIN_WIDTH = 90;
const FALLBACK_CONTEXT_LIMIT = 131_072;

type ThemeCtx = { colors: ThemeColors; syntaxStyle: SyntaxStyle };

const ThemeContext = createContext<ThemeCtx>(getTheme());

export function useTheme() { return useContext(ThemeContext); }

const HELP_TEXT = `Available commands:
  /quit     Exit Atom Neo
  /help     Show this help message
  /clear    Clear chat history
  /compact  Compress session context

Keyboard shortcuts:
  Ctrl+C      Exit (press twice)
  Up/Down     Navigate input history
  /           Open command menu
  Tab         Autocomplete command
  Esc         Dismiss command menu
  Shift+Enter New line`;

export function App({ url, serverInfo, onQuit, exitHint }: { url: string; serverInfo: ServerInfo; onQuit?: () => void; exitHint?: string | null }) {
  const { width } = useTerminalDimensions();
  const { send, clearMessages, addMessage, compact } = useChat(url, undefined, serverInfo.toolInfos, serverInfo.mcpServerInfos);
  const theme = useMemo(() => getTheme(serverInfo.theme), [serverInfo.theme]);
  const showSidebar = width >= SIDEBAR_MIN_WIDTH;
  const contextLimit = serverInfo.contextLimit ?? FALLBACK_CONTEXT_LIMIT;

  useEffect(() => { useInputHistory.getState().init(serverInfo.sandbox); }, [serverInfo.sandbox]);

  const handleHelp = useCallback(() => {
    addMessage({ role: "info", content: HELP_TEXT, id: useChatStore.getState().generateId(), timestamp: Date.now() });
  }, [addMessage]);

  const handleClear = useCallback(() => { clearMessages(); }, [clearMessages]);

  const handleCompact = useCallback(() => { compact(); }, [compact]);

  return (
    <ThemeContext.Provider value={theme}>
      <box flexDirection="column" width="100%" height="100%" backgroundColor={theme.colors.bg.page}>
        <StatusBar serverInfo={serverInfo} />
        <box flexDirection="row" flexGrow={1}>
          <box flexGrow={1} flexDirection="column" overflow="hidden" border={showSidebar ? ['right'] : false} borderColor={theme.colors.border.default} borderStyle="single">
            <ChatView />
            <InputBar onSend={send} onQuit={onQuit} onHelp={handleHelp} onClear={handleClear} onCompact={handleCompact} />
            <StatusLine hint={exitHint} />
          </box>
          {showSidebar && <Sidebar serverInfo={serverInfo} contextLimit={contextLimit} />}
        </box>
      </box>
    </ThemeContext.Provider>
  );
}
