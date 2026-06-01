/** @jsxImportSource react */
import React from "react";
import { render } from "ink";
import { parseArgs } from "node:util";
import { SetupWizard } from "./components/SetupWizard";

export async function runWizard(sandboxPath: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const { unmount, waitUntilExit } = render(
      <SetupWizard
        sandboxPath={sandboxPath}
        onComplete={() => {
          unmount();
          resolve();
        }}
        onAbort={() => {
          unmount();
          process.exit(1);
        }}
      />,
    );

    waitUntilExit().catch(() => {});
  });
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: { sandbox: { type: "string" } },
  });

  const sandbox = values.sandbox as string;
  if (!sandbox) {
    console.error("Usage: --sandbox <path>");
    process.exit(1);
  }

  runWizard(sandbox).then(() => process.exit(0));
}
