import { createCliRenderer } from "@opentui/core";
import type { KeyEvent } from "@opentui/core";
import { createRoot } from "@opentui/react";
import React from "react";
import { ensureBunRuntimePluginSupport } from "@atom-neo/tui-kit";
import { MenuApp } from "./menu-app";
import type { MenuActions, MenuInitialRoute, MenuLaunch } from "./menu-types";

/** Launch the OpenTUI menu/config shell. Non-TTY invocations fail instead of degrading. */
export async function startMenuApp(
  sandbox: string,
  options: {
    actions: MenuActions;
    initialRoute?: MenuInitialRoute;
    workspaceExplicit?: boolean;
  },
): Promise<MenuLaunch | undefined> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("menu requires an interactive terminal");
  }
  await ensureBunRuntimePluginSupport();

  return new Promise<MenuLaunch | undefined>((resolve, reject) => {
    let settled = false;
    let launch: MenuLaunch | undefined;
    let renderer: Awaited<ReturnType<typeof createCliRenderer>> | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      process.stdin.off("end", abort);
      resolve(launch);
    };
    const abort = () => {
      if (settled) return;
      if (renderer) renderer.destroy();
      else finish();
    };

    process.stdin.on("end", abort);
    createCliRenderer({
      exitOnCtrlC: false,
      screenMode: "alternate-screen",
      backgroundColor: "#05090c",
      onDestroy: finish,
    }).then(createdRenderer => {
      renderer = createdRenderer;
      if (settled) { renderer.destroy(); return; }
      renderer.keyInput.on("keypress", (key: KeyEvent) => {
        if (key.ctrl && (key.name === "c" || key.name === "d")) abort();
      });
      createRoot(renderer).render(React.createElement(MenuApp, {
        sandbox,
        workspaceExplicit: options.workspaceExplicit,
        initialRoute: options.initialRoute,
        actions: options.actions,
        onExit: (next) => {
          launch = next;
          createdRenderer.destroy();
        },
      }));
    }).catch(error => {
      process.stdin.off("end", abort);
      settled = true;
      reject(error);
    });
  });
}
