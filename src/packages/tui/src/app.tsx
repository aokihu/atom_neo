import "@opentui/react/runtime-plugin-support";
import { createCliRenderer, type KeyEvent } from "@opentui/core";
import { createRoot } from "@opentui/react";
import React, { useState } from "react";
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
      const hintSetter = { current: null as ((msg: string | null) => void) | null };

      renderer.keyInput.on("keypress", (key: KeyEvent) => {
        if (!key.ctrl || key.name !== "c") return;

        const now = Date.now();
        if (lastPressTime > 0 && now - lastPressTime < 2000) {
          if (pressTimer) clearTimeout(pressTimer);
          hintSetter.current?.(null);
          handleQuit();
          return;
        }

        lastPressTime = Date.now();
        if (pressTimer) clearTimeout(pressTimer);
        pressTimer = setTimeout(() => {
          lastPressTime = 0;
          hintSetter.current?.(null);
        }, 3000);
        hintSetter.current?.("Press Ctrl+C again within 2s to exit");
      });

      function AppRoot() {
        const [exitHint, setExitHint] = useState<string | null>(null);
        hintSetter.current = setExitHint;
        return React.createElement(App, {
          url: params.url,
          serverInfo: params.serverInfo,
          onQuit: handleQuit,
          exitHint,
        });
      }

      createRoot(renderer).render(React.createElement(AppRoot));
    });
  });
}
