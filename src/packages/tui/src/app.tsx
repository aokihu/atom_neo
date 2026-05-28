import "@opentui/react/runtime-plugin-support";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./components/App";
import type { ServerInfo } from "./types";

/** Launch the terminal UI using OpenTUI React renderer. */
export function startTui(params: {
  url: string;
  sessionId?: string;
  serverInfo: ServerInfo;
}): Promise<void> {
  return new Promise<void>((resolve) => {
    createCliRenderer({
      exitOnCtrlC: true,
      screenMode: "alternate-screen",
      backgroundColor: "#0d1117",
      onDestroy: () => resolve(),
    }).then(renderer => {
      createRoot(renderer).render(
        <App url={params.url} serverInfo={params.serverInfo} />,
      );
    });
  });
}
