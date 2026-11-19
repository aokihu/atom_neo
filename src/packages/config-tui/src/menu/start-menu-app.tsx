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
    actions: MenuActions | (() => MenuActions);
    initialRoute?: MenuInitialRoute;
    /** Feedback from a previously failed launch. */
    error?: string;
  },
): Promise<MenuLaunch | undefined> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("menu requires an interactive terminal");
  }
  const actions = typeof options.actions === "function" ? options.actions() : options.actions;
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
    // Release the terminal stream lease before another menu renderer can start.
    const afterDestroy = () => {
      const closed = (renderer as unknown as { nativeClosed?: Promise<void> } | undefined)?.nativeClosed;
      void Promise.resolve(closed).then(finish, finish);
    };
    const stop = (next?: MenuLaunch) => {
      launch = next;
      if (renderer) {
        renderer.destroy();
        afterDestroy();
      } else finish();
    };
    const abort = () => stop();

    process.stdin.on("end", abort);
    createCliRenderer({
      exitOnCtrlC: false,
      screenMode: "alternate-screen",
      backgroundColor: "#05090c",
      onDestroy: afterDestroy,
    }).then(createdRenderer => {
      renderer = createdRenderer;
      if (settled) { renderer.destroy(); return; }
      renderer.keyInput.on("keypress", (key: KeyEvent) => {
        if (key.ctrl && (key.name === "c" || key.name === "d")) abort();
      });
      createRoot(renderer).render(React.createElement(MenuApp, {
        sandbox,
        initialRoute: options.initialRoute,
        initialError: options.error,
        actions,
        onExit: (next) => stop(next),
      }));
    }).catch(error => {
      process.stdin.off("end", abort);
      settled = true;
      reject(error);
    });
  });
}
