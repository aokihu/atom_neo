import { createCliRenderer } from "@opentui/core";
import type { KeyEvent } from "@opentui/core";
import { createRoot } from "@opentui/react";
import React from "react";
import { ensureBunRuntimePluginSupport } from "@atom-neo/tui-kit";
import { WizardApp } from "./components/WizardApp";
import { closeRenderer, waitForRendererClosed } from "./renderer-lifecycle";
import type { ConfigRenderer } from "./renderer-lifecycle";
import type { GatewayInstanceActions } from "./gateway-status";
import type { WizardInitialView } from "./wizard/wizard-reducer";

/** Launch the standalone first-run wizard; config editing is MenuApp Configure only. */
export async function startWizard(
  sandboxPath: string,
  mode: "first-run",
  options: { gatewayActions?: GatewayInstanceActions; initialView?: WizardInitialView } = {},
): Promise<boolean> {
  if ((mode as string) !== "first-run") {
    throw new Error("startWizard only supports first-run; config editing uses atom config / MenuApp Configure");
  }
  await ensureBunRuntimePluginSupport();
  return new Promise<boolean>((resolve, reject) => {
    let settled = false;
    let completed = false;
    let renderer: ConfigRenderer | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      process.stdin.off("end", abort);
      if (!completed && mode === "first-run") reject(new Error("Configuration cancelled"));
      else resolve(completed);
    };
    const abort = () => {
      if (settled) return;
      closeRenderer(renderer, finish);
    };

    // EOF (redirected stdin) must not leave the wizard hanging forever
    process.stdin.on("end", abort);

    createCliRenderer({
      exitOnCtrlC: false,
      screenMode: "alternate-screen",
      backgroundColor: "#05090c",
      onDestroy: () => waitForRendererClosed(renderer, finish),
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
        initialView: options.initialView,
        gatewayActions: options.gatewayActions,
        onComplete: () => { completed = true; closeRenderer(createdRenderer, finish); },
        onAbort: abort,
      }));
    }).catch(error => {
      process.stdin.off("end", abort);
      settled = true;
      reject(error);
    });
  });
}
