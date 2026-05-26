import { useState, useEffect } from "react";
import type { ServerInfo } from "../types";

export function Sidebar({ serverInfo }: { serverInfo: ServerInfo }) {
  const [uptime, setUptime] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setUptime(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const mins = Math.floor(uptime / 60);
  const secs = uptime % 60;

  return (
    <box
      width={48}
      borderStyle="single"
      borderColor="#21262d"
      backgroundColor="#0d1117"
      padding={1}
      flexDirection="column"
    >
      <text fg="#e6edf3"><strong>Info</strong></text>
      <text fg="#21262d">{'─'.repeat(44)}</text>

      <box flexDirection="row" gap={1}>
        <text fg="#484f58">port</text>
        <text fg="#8b949e">{String(serverInfo.port)}</text>
      </box>
      <box flexDirection="row" gap={1}>
        <text fg="#484f58">host</text>
        <text fg="#8b949e">{serverInfo.host}</text>
      </box>
      <box flexDirection="row" gap={1}>
        <text fg="#484f58">model</text>
        <text fg="#8b949e">{serverInfo.model}</text>
      </box>
      <box flexDirection="row" gap={1}>
        <text fg="#484f58">root</text>
        <text fg="#8b949e">{serverInfo.sandbox.length > 32 ? `…${serverInfo.sandbox.slice(-31)}` : serverInfo.sandbox}</text>
      </box>
      <box flexDirection="row" gap={1}>
        <text fg="#484f58">up</text>
        <text fg="#8b949e">{mins}m {secs}s</text>
      </box>

      <text fg="#21262d">{'─'.repeat(44)}</text>
      <text fg="#8b949e">{serverInfo.tools.join("  ")}</text>

      <text flexGrow={1} />
      <text fg="#30363d">{'─'.repeat(44)}</text>
      <text fg="#484f58">v{serverInfo.version}</text>
    </box>
  );
}
