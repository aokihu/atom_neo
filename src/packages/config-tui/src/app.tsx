import { createCliRenderer } from "@opentui/core";
import type { KeyEvent } from "@opentui/core";
import { createRoot } from "@opentui/react";
import React from "react";
import { ensureBunRuntimePluginSupport } from "@atom-neo/tui-kit";
import { WizardApp } from "./components/WizardApp";
import type { WizardMode } from "./wizard-logic";

/** Launch the standalone OpenTUI wizard (first-run setup or config editor). */
export async function startWizard(sandboxPath: string, mode: WizardMode): Promise<boolean> {
  await ensureBunRuntimePluginSupport();
  return new Promise<boolean>((resolve, reject) => {
    let settled = false;
    let completed = false;
    let renderer: Awaited<ReturnType<typeof createCliRenderer>> | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      process.stdin.off("end", abort);
      if (!completed && mode === "first-run") reject(new Error("Configuration cancelled"));
      else resolve(completed);
    };
    const abort = () => {
      if (settled) return;
      if (renderer) renderer.destroy();
      else finish();
    };

    // EOF (redirected stdin) must not leave the wizard hanging forever
    process.stdin.on("end", abort);

    createCliRenderer({
      exitOnCtrlC: false,
      screenMode: "alternate-screen",
      backgroundColor: "#05090c",
      onDestroy: () => finish(),
    }).then(createdRenderer => {
      renderer = createdRenderer;
      if (settled) { renderer.destroy(); return; }
      renderer.keyInput.on("keypress", (key: KeyEvent) => {
        if (key.ctrl && (key.name === "c" || key.name === "d")) {
          abort();
        }
      });

      createRoot(renderer).render(React.createElement(WizardApp, {
        sandboxPath,
        mode,
        onComplete: () => { completed = true; createdRenderer.destroy(); },
        onAbort: abort,
      }));
    }).catch(error => {
      process.stdin.off("end", abort);
      settled = true;
      reject(error);
    });
  });
}
