import { useTerminalDimensions } from "@opentui/react";
import { useChat } from "../hooks/useChat";
import type { ServerInfo } from "../types";
import { StatusBar } from "./StatusBar";
import { ChatView } from "./ChatView";
import { InputBar } from "./InputBar";
import { Sidebar } from "./Sidebar";

export function App({ url, serverInfo }: { url: string; serverInfo: ServerInfo }) {
  const { width, height } = useTerminalDimensions();
  const { messages, send } = useChat(url);
  const showSidebar = width >= 90;

  return (
    <box flexDirection="column" width={width} height={height} backgroundColor="#0d1117">
      <StatusBar />
      <box flexDirection="row" flexGrow={1} flexShrink={1}>
        <box flexGrow={1} flexDirection="column">
          <ChatView messages={messages} />
          <InputBar onSend={send} />
        </box>
        {showSidebar && <Sidebar serverInfo={serverInfo} />}
      </box>
    </box>
  );
}
