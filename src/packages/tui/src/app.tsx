import "@opentui/react/runtime-plugin-support";
import { createCliRenderer, type KeyEvent } from "@opentui/core";
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

      let lastPressTime = 0;
      let pressTimer: ReturnType<typeof setTimeout> | null = null;

      renderer.keyInput.on("keypress", (key: KeyEvent) => {
        if (!key.ctrl || key.name !== "c") return;

        const now = Date.now();
        if (lastPressTime > 0 && now - lastPressTime < 2000) {
          if (pressTimer) clearTimeout(pressTimer);
          handleQuit();
          return;
        }

        lastPressTime = Date.now();
        if (pressTimer) clearTimeout(pressTimer);
        pressTimer = setTimeout(() => { lastPressTime = 0; }, 3000);
        process.stderr.write("\x1b[1m\x1b[33mPress Ctrl+C again within 2s to exit\x1b[0m\n");
      });

      createRoot(renderer).render(
        <App url={params.url} serverInfo={params.serverInfo} onQuit={handleQuit} />,
      );
    });
  });
}
