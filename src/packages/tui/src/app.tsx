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
      exitOnCtrlC: false,
      screenMode: "alternate-screen",
      backgroundColor: "#0d1117",
      onDestroy: () => resolve(),
    }).then(renderer => {
      const handleQuit = () => {
        renderer.destroy();
        process.exit(0);
      };

      let lastSigintTime = 0;
      let sigintTimer: ReturnType<typeof setTimeout> | null = null;

      process.on("SIGINT", () => {
        const now = Date.now();
        if (lastSigintTime > 0 && now - lastSigintTime < 2000) {
          if (sigintTimer) clearTimeout(sigintTimer);
          handleQuit();
          return;
        }
        lastSigintTime = Date.now();
        if (sigintTimer) clearTimeout(sigintTimer);
        sigintTimer = setTimeout(() => { lastSigintTime = 0; }, 3000);
        process.stderr.write("\x1b[1m\x1b[33mPress Ctrl+C again within 2s to exit\x1b[0m\n");
      });

      createRoot(renderer).render(
        <App url={params.url} serverInfo={params.serverInfo} onQuit={handleQuit} />,
      );
    });
  });
}
