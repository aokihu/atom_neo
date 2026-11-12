import { useMemo, useEffect, useCallback, useState } from "react";
import { useTerminalDimensions } from "@opentui/react";
import { useChat } from "../hooks/useChat";
import type { ChatClientError } from "../hooks/useChat";
import { useChatStore } from "../stores/chat";
import { ThemeProvider, getTheme } from "@atom-neo/tui-kit";
import type { ServerInfo, ToolGroupMessage } from "../types";
import { StatusBar } from "./StatusBar";
import { StatusLine } from "./StatusLine";
import { ChatView } from "./ChatView";
import { InputBar } from "./InputBar";
import { PanelTitle } from "./PanelTitle";
import { RuntimeSidebar } from "./RuntimeSidebar";
import { Sidebar } from "./Sidebar";
import { AppModal } from "./app/AppModal";
import type { ActiveModal } from "./app/app-modal-config";
import { useInputHistory } from "../stores/inputHistory";
import { SettingsModal } from "./SettingsModal";

const TELEMETRY_MIN_WIDTH = 100;
const RUNTIME_MIN_WIDTH = 150;
const FALLBACK_CONTEXT_LIMIT = 131_072;

export type TuiLayoutMode = "compact" | "medium" | "wide";

export function resolveTuiLayout(width: number): TuiLayoutMode {
  if (width >= RUNTIME_MIN_WIDTH) return "wide";
  if (width >= TELEMETRY_MIN_WIDTH) return "medium";
  return "compact";
}

const HELP_TEXT = `Available commands:
  /quit     Exit Atom Neo
  /help     Show this help message
  /clear    Clear chat history
  /compact  Compress session context
  /settings Adjust runtime settings

Keyboard shortcuts:
  Ctrl+C      Exit (press twice)
  Up/Down     Input history / Command menu
  /           Open command menu
  Tab         Autocomplete command
  Esc         Dismiss command menu / press twice to cancel running task
  Shift+Enter New line`;

export function App({ url, sessionId, adminToken, historySandbox, serverInfo, onServerInfoChange, onQuit, exitHint }: { url: string; sessionId?: string; adminToken?: string; historySandbox?: string; serverInfo: ServerInfo; onServerInfoChange?: (info: ServerInfo) => void; onQuit?: () => void; exitHint?: string | null }) {
  const { width } = useTerminalDimensions();
  const theme = useMemo(() => getTheme(serverInfo.theme), [serverInfo.theme]);
  const layout = resolveTuiLayout(width);
  const showRuntime = layout === "wide";
  const showTelemetry = layout !== "compact";
  const contextLimit = serverInfo.contextLimit ?? FALLBACK_CONTEXT_LIMIT;
  const busy = useChatStore(state => state.busy);

  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [taskHint, setTaskHint] = useState<string | null>(null);
  const handleClientError = useCallback((error: ChatClientError) => {
    setActiveModal({ kind: "error", title: error.title, message: error.message });
  }, []);
  const { send, clearMessages, addMessage, compact, cancel } = useChat(
    url,
    sessionId,
    serverInfo.toolInfos,
    serverInfo.mcpServerInfos,
    handleClientError,
  );

  useEffect(() => { useInputHistory.getState().init(historySandbox ?? process.cwd()); }, [historySandbox]);

  const closeModal = useCallback(() => { setActiveModal(null); }, []);

  const handleHelp = useCallback(() => {
    addMessage({ role: "info", content: HELP_TEXT, id: useChatStore.getState().generateId(), timestamp: Date.now() });
  }, [addMessage]);

  const handleClear = useCallback(() => { setActiveModal({ kind: "confirm-clear" }); }, []);

  const handleQuit = useCallback(() => { setActiveModal({ kind: "confirm-quit" }); }, []);

  const handleSettings = useCallback(() => { setActiveModal({ kind: "settings" }); }, []);

  const handleCompact = useCallback(() => { compact(); }, [compact]);
  const handleOpenToolDetails = useCallback((groups: ToolGroupMessage[]) => {
    setActiveModal({ kind: "tool-details", groups });
  }, []);
  const handleCancelTask = useCallback(() => {
    if (!cancel()) setTaskHint(null);
  }, [cancel]);

  return (
    <ThemeProvider value={theme}>
      <box flexDirection="column" width="100%" height="100%" backgroundColor={theme.colors.bg.page}>
        <StatusBar serverInfo={serverInfo} />
        <box flexDirection="row" flexGrow={1} overflow="hidden">
          {showRuntime && <RuntimeSidebar />}
          <box
            flexGrow={1}
            flexBasis={0}
            flexDirection="column"
            overflow="hidden"
            backgroundColor={theme.colors.bg.codeBlock}
          >
            <PanelTitle title="CONVERSATION" meta={busy ? "ACTIVE" : "READY"} tone="primary" />
            <ChatView onOpenToolDetails={handleOpenToolDetails} />
            <InputBar
              onSend={send}
              onQuit={handleQuit}
              onHelp={handleHelp}
              onClear={handleClear}
              onCompact={handleCompact}
              onSettings={handleSettings}
              onCancelTask={handleCancelTask}
              onCancelHint={setTaskHint}
              disabled={activeModal !== null}
            />
          </box>
          {showTelemetry && <Sidebar contextLimit={contextLimit} url={url} adminToken={adminToken} />}
        </box>
        <StatusLine hint={taskHint ?? exitHint} />
        <AppModal
          modal={activeModal}
          textColor={theme.colors.text.secondary}
          onClose={closeModal}
          onClearMessages={clearMessages}
          onQuit={onQuit}
        />
        <SettingsModal
          open={activeModal?.kind === "settings"}
          url={url}
          adminToken={adminToken}
          serverInfo={serverInfo}
          onSaved={(info) => onServerInfoChange?.(info)}
          onClose={closeModal}
        />
      </box>
    </ThemeProvider>
  );
}
