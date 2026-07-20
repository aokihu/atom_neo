import { createContext, useContext, useMemo, useEffect, useCallback, useState } from "react";
import { useTerminalDimensions } from "@opentui/react";
import "opentui-spinner/react";
import { useChat } from "../hooks/useChat";
import type { ChatClientError } from "../hooks/useChat";
import { useChatStore } from "../stores/chat";
import { getTheme } from "../theme";
import type { ServerInfo, ThemeColors, Message } from "../types";
import { SyntaxStyle } from "@opentui/core";
import { StatusBar } from "./StatusBar";
import { StatusLine } from "./StatusLine";
import { ChatView } from "./ChatView";
import { InputBar } from "./InputBar";
import { Sidebar } from "./Sidebar";
import { Modal } from "./modal";
import type { ModalAction } from "./modal";
import { useInputHistory } from "../stores/inputHistory";

const SIDEBAR_MIN_WIDTH = 90;
const FALLBACK_CONTEXT_LIMIT = 131_072;

type ActiveModal =
  | { kind: "confirm-clear" }
  | { kind: "confirm-quit" }
  | { kind: "error"; title: string; message: string }
  | null;

const MODAL_ACTIONS: ModalAction[] = [
  { key: "cancel", label: "Cancel", role: "cancel" },
  { key: "ok", label: "OK", role: "confirm", variant: "primary" },
];

const ERROR_MODAL_ACTIONS: ModalAction[] = [
  { key: "ok", label: "OK", role: "confirm", variant: "primary" },
];

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
  Up/Down     Input history / Command menu
  /           Open command menu
  Tab         Autocomplete command
  Esc         Dismiss command menu / press twice to cancel running task
  Shift+Enter New line`;

export function App({ url, serverInfo, onQuit, exitHint }: { url: string; serverInfo: ServerInfo; onQuit?: () => void; exitHint?: string | null }) {
  const { width } = useTerminalDimensions();
  const theme = useMemo(() => getTheme(serverInfo.theme), [serverInfo.theme]);
  const showSidebar = width >= SIDEBAR_MIN_WIDTH;
  const contextLimit = serverInfo.contextLimit ?? FALLBACK_CONTEXT_LIMIT;

  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [taskHint, setTaskHint] = useState<string | null>(null);
  const handleClientError = useCallback((error: ChatClientError) => {
    setActiveModal({ kind: "error", title: error.title, message: error.message });
  }, []);
  const { send, clearMessages, addMessage, compact, cancel } = useChat(
    url,
    undefined,
    serverInfo.toolInfos,
    serverInfo.mcpServerInfos,
    handleClientError,
  );

  useEffect(() => { useInputHistory.getState().init(serverInfo.sandbox); }, [serverInfo.sandbox]);

  const closeModal = useCallback(() => { setActiveModal(null); }, []);

  const handleHelp = useCallback(() => {
    addMessage({ role: "info", content: HELP_TEXT, id: useChatStore.getState().generateId(), timestamp: Date.now() });
  }, [addMessage]);

  const handleClear = useCallback(() => { setActiveModal({ kind: "confirm-clear" }); }, []);

  const handleQuit = useCallback(() => { setActiveModal({ kind: "confirm-quit" }); }, []);

  const handleCompact = useCallback(() => { compact(); }, [compact]);
  const handleCancelTask = useCallback(() => {
    if (!cancel()) setTaskHint(null);
  }, [cancel]);

  return (
    <ThemeContext.Provider value={theme}>
      <box flexDirection="column" width="100%" height="100%" backgroundColor={theme.colors.bg.page}>
        <StatusBar serverInfo={serverInfo} />
        <box flexDirection="row" flexGrow={1}>
          <box flexGrow={1} flexDirection="column" overflow="hidden" border={showSidebar ? ['right'] : false} borderColor={theme.colors.border.default} borderStyle="single">
            <ChatView />
            <InputBar
              onSend={send}
              onQuit={handleQuit}
              onHelp={handleHelp}
              onClear={handleClear}
              onCompact={handleCompact}
              onCancelTask={handleCancelTask}
              onCancelHint={setTaskHint}
              disabled={activeModal !== null}
            />
            <StatusLine hint={taskHint ?? exitHint} />
          </box>
          {showSidebar && <Sidebar serverInfo={serverInfo} contextLimit={contextLimit} />}
        </box>
        {activeModal && (
          <Modal
            open
            title={activeModal.kind === "confirm-clear"
              ? "Clear conversation?"
              : activeModal.kind === "confirm-quit"
                ? "Exit Atom Neo?"
                : activeModal.title}
            placement="center"
            width={56}
            actions={activeModal.kind === "error" ? ERROR_MODAL_ACTIONS : MODAL_ACTIONS}
            defaultActionKey={activeModal.kind === "error" ? "ok" : "cancel"}
            onClose={closeModal}
            onAction={(key) => {
              if (activeModal.kind === "error") { closeModal(); return; }
              if (key === "cancel") { closeModal(); return; }
              if (activeModal.kind === "confirm-clear") { clearMessages(); closeModal(); return; }
              if (activeModal.kind === "confirm-quit") { closeModal(); onQuit?.(); }
            }}
          >
            <text fg={theme.colors.text.secondary}>
              {activeModal.kind === "confirm-clear"
                ? "This will remove all messages from the current TUI view."
                : activeModal.kind === "confirm-quit"
                  ? "The current terminal UI session will be closed."
                  : activeModal.message}
            </text>
          </Modal>
        )}
      </box>
    </ThemeContext.Provider>
  );
}
