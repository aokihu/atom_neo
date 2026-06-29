import { createContext, useContext, useMemo, useEffect, useCallback, useState, useRef } from "react";
import { useTerminalDimensions } from "@opentui/react";
import "opentui-spinner/react";
import { useChat } from "../hooks/useChat";
import { useChatStore } from "../stores/chat";
import { getTheme } from "../theme";
import type { ServerInfo, ThemeColors, Message } from "../types";
import { SyntaxStyle } from "@opentui/core";
import type { BoxRenderable } from "@opentui/core";
import { StatusBar } from "./StatusBar";
import { StatusLine } from "./StatusLine";
import { ChatView } from "./ChatView";
import { InputBar } from "./InputBar";
import { Sidebar } from "./Sidebar";
import { Modal } from "./modal";
import type { ModalAction } from "./modal";
import { CommandPalette } from "./CommandPalette";
import type { Command } from "./CommandMenu";
import { useInputHistory } from "../stores/inputHistory";

const SIDEBAR_MIN_WIDTH = 90;
const FALLBACK_CONTEXT_LIMIT = 131_072;

type ActiveModal = { kind: "confirm-clear" } | { kind: "confirm-quit" } | null;

const MODAL_ACTIONS: ModalAction[] = [
  { key: "cancel", label: "Cancel", role: "cancel" },
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
  Up/Down     Input history / Command palette
  /           Open command palette
  Enter       Run selected command
  Esc         Dismiss command palette
  Shift+Enter New line`;

export function App({ url, serverInfo, onQuit, exitHint }: { url: string; serverInfo: ServerInfo; onQuit?: () => void; exitHint?: string | null }) {
  const { width } = useTerminalDimensions();
  const { send, clearMessages, addMessage, compact } = useChat(url, undefined, serverInfo.toolInfos, serverInfo.mcpServerInfos);
  const theme = useMemo(() => getTheme(serverInfo.theme), [serverInfo.theme]);
  const showSidebar = width >= SIDEBAR_MIN_WIDTH;
  const contextLimit = serverInfo.contextLimit ?? FALLBACK_CONTEXT_LIMIT;

  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [palette, setPalette] = useState<{ seed: string } | null>(null);
  const anchorRef = useRef<BoxRenderable>(null);

  useEffect(() => { useInputHistory.getState().init(serverInfo.sandbox); }, [serverInfo.sandbox]);

  const closeModal = useCallback(() => { setActiveModal(null); }, []);

  const handleHelp = useCallback(() => {
    addMessage({ role: "info", content: HELP_TEXT, id: useChatStore.getState().generateId(), timestamp: Date.now() });
  }, [addMessage]);

  const handleClear = useCallback(() => { setActiveModal({ kind: "confirm-clear" }); }, []);

  const handleQuit = useCallback(() => { setActiveModal({ kind: "confirm-quit" }); }, []);

  const handleCompact = useCallback(() => { compact(); }, [compact]);

  const openPalette = useCallback((seed: string) => { setPalette({ seed }); }, []);

  const closePalette = useCallback(() => { setPalette(null); }, []);

  const runCommand = useCallback((cmd: Command) => {
    setPalette(null);
    switch (cmd.name) {
      case "/quit": handleQuit(); break;
      case "/help": handleHelp(); break;
      case "/clear": handleClear(); break;
      case "/compact": handleCompact(); break;
    }
  }, [handleQuit, handleHelp, handleClear, handleCompact]);

  return (
    <ThemeContext.Provider value={theme}>
      <box flexDirection="column" width="100%" height="100%" backgroundColor={theme.colors.bg.page}>
        <StatusBar serverInfo={serverInfo} />
        <box flexDirection="row" flexGrow={1}>
          <box flexGrow={1} flexDirection="column" overflow="hidden" border={showSidebar ? ['right'] : false} borderColor={theme.colors.border.default} borderStyle="single">
            <ChatView />
            <InputBar onSend={send} onOpenPalette={openPalette} disabled={activeModal !== null || palette !== null} anchorRef={anchorRef} />
            <StatusLine hint={exitHint} />
          </box>
          {showSidebar && <Sidebar serverInfo={serverInfo} contextLimit={contextLimit} />}
        </box>
        {activeModal && (
          <Modal
            open
            title={activeModal.kind === "confirm-clear" ? "Clear conversation?" : "Exit Atom Neo?"}
            placement="center"
            width={56}
            actions={MODAL_ACTIONS}
            defaultActionKey="cancel"
            onClose={closeModal}
            onAction={(key) => {
              if (key === "cancel") { closeModal(); return; }
              if (activeModal.kind === "confirm-clear") { clearMessages(); closeModal(); return; }
              if (activeModal.kind === "confirm-quit") { closeModal(); onQuit?.(); }
            }}
          >
            <text fg={theme.colors.text.secondary}>
              {activeModal.kind === "confirm-clear"
                ? "This will remove all messages from the current TUI view."
                : "The current terminal UI session will be closed."}
            </text>
          </Modal>
        )}
        {palette && (
          <CommandPalette
            open
            initialFilter={palette.seed}
            anchorRef={anchorRef}
            onRun={runCommand}
            onClose={closePalette}
          />
        )}
      </box>
    </ThemeContext.Provider>
  );
}
