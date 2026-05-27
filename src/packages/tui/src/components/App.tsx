import { createContext, useContext } from "react";
import { useTerminalDimensions } from "@opentui/react";
import { useChat } from "../hooks/useChat";
import { getTheme } from "../theme";
import type { ServerInfo, ThemeColors } from "../types";
import { SyntaxStyle } from "@opentui/core";
import { StatusBar } from "./StatusBar";
import { ChatView } from "./ChatView";
import { InputBar } from "./InputBar";
import { Sidebar } from "./Sidebar";

type ThemeCtx = { colors: ThemeColors; syntaxStyle: SyntaxStyle };

const ThemeContext = createContext<ThemeCtx>(getTheme());

export function useTheme() { return useContext(ThemeContext); }

export function App({ url, serverInfo }: { url: string; serverInfo: ServerInfo }) {
  const { width } = useTerminalDimensions();
  const { messages, send, tokenUsage } = useChat(url);
  const theme = getTheme(serverInfo.theme);
  const showSidebar = width >= 90;

  return (
    <ThemeContext.Provider value={theme}>
      <box flexDirection="column" width="100%" height="100%" backgroundColor={theme.colors.bg.page}>
        <StatusBar />
        <box flexDirection="row" flexGrow={1}>
          <box flexGrow={1} flexDirection="column" borderRight={showSidebar} borderColor={theme.colors.border.default} borderRightStyle="single">
            <ChatView messages={messages} />
            <InputBar onSend={send} />
          </box>
          {showSidebar && <Sidebar serverInfo={serverInfo} tokenUsage={tokenUsage} contextLimit={serverInfo.contextLimit ?? 131072} />}
        </box>
      </box>
    </ThemeContext.Provider>
  );
}
