import "@opentui/react/runtime-plugin-support";
import { createCliRenderer } from "@opentui/core";
import type { KeyEvent } from "@opentui/core";
import { createRoot } from "@opentui/react";
import React from "react";
import { WizardApp } from "./components/WizardApp";
import type { WizardMode } from "./wizard-logic";

/** Launch the standalone OpenTUI wizard (first-run setup or config editor). */
export function startWizard(sandboxPath: string, mode: WizardMode): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(); } };
    const abort = () => {
      if (settled) return;
      settled = true;
      if (mode === "first-run") process.exit(1);
      else resolve();
    };

    // EOF (redirected stdin) must not leave the wizard hanging forever
    process.stdin.on("end", abort);

    createCliRenderer({
      exitOnCtrlC: false,
      screenMode: "alternate-screen",
      backgroundColor: "#05090c",
      onDestroy: () => finish(),
    }).then(renderer => {
      renderer.keyInput.on("keypress", (key: KeyEvent) => {
        if (key.ctrl && (key.name === "c" || key.name === "d")) {
          renderer.destroy();
          abort();
        }
      });

      createRoot(renderer).render(React.createElement(WizardApp, {
        sandboxPath,
        mode,
        onComplete: () => renderer.destroy(),
        onAbort: () => {
          renderer.destroy();
          abort();
        },
      }));
    });
  });
}
