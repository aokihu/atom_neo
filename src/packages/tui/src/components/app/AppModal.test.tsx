import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "@opentui/react";
import { createTestRenderer } from "@opentui/core/testing";
import { AppModal } from "./AppModal";
import type { ActiveModal } from "./app-modal-config";
import type { ToolGroupMessage } from "../../types";

beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); });
afterEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false }); });

const group: ToolGroupMessage = {
  role: "tool-group",
  id: "tools",
  timestamp: 1,
  collapsed: false,
  entries: [
    { toolCallId: "ok", toolName: "read", phase: "done", detail: "result" },
    { toolCallId: "err", toolName: "webfetch", phase: "error", detail: "failed" },
  ],
};

async function mount(modal: ActiveModal) {
  const setup = await createTestRenderer({ width: 100, height: 30 });
  const root = createRoot(setup.renderer);
  const events: string[] = [];
  await act(async () => root.render(
    <AppModal
      modal={modal}
      textColor="#8196a0"
      onClose={() => events.push("close")}
      onClearMessages={() => events.push("clear")}
      onQuit={() => events.push("quit")}
    />,
  ));
  await setup.renderOnce();
  const press = async (...keys: string[]) => {
    for (const key of keys) {
      await act(async () => setup.mockInput.pressKey(key));
      await setup.renderOnce();
    }
  };
  const cleanup = async () => {
    await act(async () => root.unmount());
    setup.renderer.destroy();
  };
  return { setup, events, press, cleanup };
}

test("renders nothing without a modal or for settings", async () => {
  for (const modal of [null, { kind: "settings" } as const]) {
    const ctx = await mount(modal);
    try {
      expect(ctx.setup.captureCharFrame().trim()).toBe("");
    } finally {
      await ctx.cleanup();
    }
  }
});

test("Esc closes the dialog without running its action", async () => {
  const ctx = await mount({ kind: "confirm-clear" });
  try {
    expect(ctx.setup.captureCharFrame()).toContain("Clear conversation?");
    await ctx.press("ESCAPE");
    await Bun.sleep(20);
    expect(ctx.events).toEqual(["close"]);
  } finally {
    await ctx.cleanup();
  }
});

test("confirm-clear defaults to cancel and clears only after choosing OK", async () => {
  const ctx = await mount({ kind: "confirm-clear" });
  try {
    await ctx.press("RETURN");
    expect(ctx.events).toEqual(["close"]);
    await ctx.press("TAB", "RETURN");
    expect(ctx.events).toEqual(["close", "clear", "close"]);
  } finally {
    await ctx.cleanup();
  }
});

test("confirm-quit closes before delegating to quit", async () => {
  const ctx = await mount({ kind: "confirm-quit" });
  try {
    expect(ctx.setup.captureCharFrame()).toContain("Exit Atom Neo?");
    await ctx.press("TAB", "RETURN");
    expect(ctx.events).toEqual(["close", "quit"]);
  } finally {
    await ctx.cleanup();
  }
});

test("error modals show their title/message and close on OK", async () => {
  const ctx = await mount({ kind: "error", title: "CONNECTION LOST", message: "socket closed" });
  try {
    const frame = ctx.setup.captureCharFrame();
    expect(frame).toContain("CONNECTION LOST");
    expect(frame).toContain("socket closed");
    await ctx.press("RETURN");
    expect(ctx.events).toEqual(["close"]);
  } finally {
    await ctx.cleanup();
  }
});

test("tool details summarize success/total and close", async () => {
  const ctx = await mount({ kind: "tool-details", groups: [group] });
  try {
    const frame = ctx.setup.captureCharFrame();
    expect(frame).toContain("TOOLS 1/2");
    expect(frame).toContain("webfetch");
    await ctx.press("RETURN");
    expect(ctx.events).toEqual(["close"]);
  } finally {
    await ctx.cleanup();
  }
});
