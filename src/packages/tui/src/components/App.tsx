import { createContext, useContext, useMemo, useEffect, useCallback, useState } from "react";
import { useTerminalDimensions } from "@opentui/react";
import "opentui-spinner/react";
import { useChat } from "../hooks/useChat";
import type { ChatClientError } from "../hooks/useChat";
import { useChatStore } from "../stores/chat";
import { getTheme } from "../theme";
import type { ServerInfo, ThemeColors, Message, ToolGroupMessage } from "../types";
import { SyntaxStyle } from "@opentui/core";
import { StatusBar } from "./StatusBar";
import { StatusLine } from "./StatusLine";
import { ChatView } from "./ChatView";
import { InputBar } from "./InputBar";
import { PanelTitle } from "./PanelTitle";
import { RuntimeSidebar } from "./RuntimeSidebar";
import { Sidebar } from "./Sidebar";
import { Modal } from "./modal";
import type { ModalAction } from "./modal";
import { useInputHistory } from "../stores/inputHistory";
import { summarizeToolGroups, ToolDetailsContent } from "./ToolMessageBox";
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

type ActiveModal =
  | { kind: "confirm-clear" }
  | { kind: "confirm-quit" }
  | { kind: "error"; title: string; message: string }
  | { kind: "tool-details"; groups: ToolGroupMessage[] }
  | { kind: "settings" }
  | null;

const MODAL_ACTIONS: ModalAction[] = [
  { key: "cancel", label: "Cancel", role: "cancel" },
  { key: "ok", label: "OK", role: "confirm", variant: "primary" },
];

const ERROR_MODAL_ACTIONS: ModalAction[] = [
  { key: "ok", label: "OK", role: "confirm", variant: "primary" },
];

const TOOL_MODAL_ACTIONS: ModalAction[] = [
  { key: "close", label: "Close", role: "confirm", variant: "primary" },
];

type ThemeCtx = { colors: ThemeColors; syntaxStyle: SyntaxStyle };

const ThemeContext = createContext<ThemeCtx>(getTheme());

export function useTheme() { return useContext(ThemeContext); }

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

export function App({ url, adminToken, serverInfo, onServerInfoChange, onQuit, exitHint }: { url: string; adminToken?: string; serverInfo: ServerInfo; onServerInfoChange?: (info: ServerInfo) => void; onQuit?: () => void; exitHint?: string | null }) {
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

  const handleSettings = useCallback(() => { setActiveModal({ kind: "settings" }); }, []);

  const handleCompact = useCallback(() => { compact(); }, [compact]);
  const handleOpenToolDetails = useCallback((groups: ToolGroupMessage[]) => {
    setActiveModal({ kind: "tool-details", groups });
  }, []);
  const handleCancelTask = useCallback(() => {
    if (!cancel()) setTaskHint(null);
  }, [cancel]);
  const toolModalSummary = activeModal?.kind === "tool-details"
    ? summarizeToolGroups(activeModal.groups)
    : null;
  const toolModalTitle = toolModalSummary
    ? `TOOLS ${toolModalSummary.success}/${toolModalSummary.total}`
    : "";

  return (
    <ThemeContext.Provider value={theme}>
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
          {showTelemetry && <Sidebar contextLimit={contextLimit} />}
        </box>
        <StatusLine hint={taskHint ?? exitHint} />
        {activeModal && activeModal.kind !== "settings" && (
          <Modal
            open
            title={activeModal.kind === "confirm-clear"
              ? "Clear conversation?"
              : activeModal.kind === "confirm-quit"
                ? "Exit Atom Neo?"
                : activeModal.kind === "tool-details"
                  ? toolModalTitle
                  : activeModal.title}
            placement="center"
            width={activeModal.kind === "tool-details" ? 84 : 56}
            height={activeModal.kind === "tool-details" ? 20 : undefined}
            actions={activeModal.kind === "error"
              ? ERROR_MODAL_ACTIONS
              : activeModal.kind === "tool-details"
                ? TOOL_MODAL_ACTIONS
                : MODAL_ACTIONS}
            defaultActionKey={activeModal.kind === "error"
              ? "ok"
              : activeModal.kind === "tool-details"
                ? "close"
                : "cancel"}
            onClose={closeModal}
            onAction={(key) => {
              if (activeModal.kind === "error") { closeModal(); return; }
              if (activeModal.kind === "tool-details") { closeModal(); return; }
              if (key === "cancel") { closeModal(); return; }
              if (activeModal.kind === "confirm-clear") { clearMessages(); closeModal(); return; }
              if (activeModal.kind === "confirm-quit") { closeModal(); onQuit?.(); }
            }}
          >
            {activeModal.kind === "tool-details"
              ? <ToolDetailsContent groups={activeModal.groups} />
              : (
                <text fg={theme.colors.text.secondary}>
                  {activeModal.kind === "confirm-clear"
                    ? "This will remove all messages from the current TUI view."
                    : activeModal.kind === "confirm-quit"
                      ? "The current terminal UI session will be closed."
                      : activeModal.message}
                </text>
              )}
          </Modal>
        )}
        <SettingsModal
          open={activeModal?.kind === "settings"}
          url={url}
          adminToken={adminToken}
          serverInfo={serverInfo}
          onSaved={(info) => onServerInfoChange?.(info)}
          onClose={closeModal}
        />
      </box>
    </ThemeContext.Provider>
  );
}
