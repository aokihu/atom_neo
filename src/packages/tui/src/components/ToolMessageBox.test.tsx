// Tool execution disclosure rendering and input regression tests.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { act, useState } from "react";
import { createRoot } from "@opentui/react";
import { createTestRenderer } from "@opentui/core/testing";
import { ToolMessageBox } from "./ToolMessageBox";
import type { ToolGroupMessage } from "../types";

const toolGroup = (): ToolGroupMessage => ({
  role: "tool-group",
  id: "tools",
  timestamp: 1,
  collapsed: false,
  entries: [
    { toolCallId: "read", toolName: "read", phase: "done", detail: "file contents" },
    { toolCallId: "web", toolName: "webfetch", phase: "executing", input: { url: "https://example.com" } },
  ],
});

beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); });
afterEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false }); });

async function renderToolMessage(message: ToolGroupMessage, width = 80, onOpenDetails?: (groups: ToolGroupMessage[]) => void) {
  const setup = await createTestRenderer({ width, height: 20 });
  const root = createRoot(setup.renderer);
  let update!: (message: ToolGroupMessage) => void;
  function Harness() {
    const [current, setCurrent] = useState(message);
    update = setCurrent;
    return <ToolMessageBox key={current.id} message={current} onOpenDetails={onOpenDetails} />;
  }
  await act(async () => root.render(<Harness />));
  await setup.renderOnce();
  return {
    ...setup,
    async update(message: ToolGroupMessage) {
      await act(async () => update(message));
      await setup.renderOnce();
    },
    async destroy() {
      await act(async () => root.unmount());
      setup.renderer.destroy();
    },
  };
}

test("shows only the current tool name and updates it in one line", async () => {
  let message = toolGroup();
  const setup = await renderToolMessage(message);
  try {
    expect(setup.captureCharFrame().trim()).toBe("webfetch");
    expect(setup.renderer.root.findDescendantById("tool-trigger-tools")?.height).toBe(1);

    message = { ...message, entries: [...message.entries, { toolCallId: "shell", toolName: "shell", phase: "preparing" }] };
    await setup.update(message);
    expect(setup.captureCharFrame().trim()).toBe("shell");

    message = { ...message, entries: message.entries.map(entry => entry.toolCallId === "shell" ? { ...entry, phase: "done" } : entry) };
    await setup.update(message);
    expect(setup.captureCharFrame().trim()).toBe("webfetch");

    message = { ...message, entries: message.entries.map(entry => ({ ...entry, phase: "error" })) };
    await setup.update(message);
    expect(setup.captureCharFrame().trim()).toBe("shell");

    setup.resize(20, 20);
    message = { ...message, entries: [{ toolCallId: "long", toolName: "mcp_server_with_a_very_long_tool_name", phase: "executing" }] };
    await setup.update(message);
    const lines = setup.captureCharFrame().split("\n").filter(line => line.trim());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("mcp_");
    expect(lines[0]).not.toContain(message.entries[0]!.toolName);
  } finally {
    await setup.destroy();
  }
});

test("toggles the existing list with mouse and keyboard and preserves the choice during updates", async () => {
  let message = toolGroup();
  const setup = await renderToolMessage(message, 100);
  try {
    const trigger = setup.renderer.root.findDescendantById("tool-trigger-tools")!;
    await act(async () => setup.mockMouse.click(trigger.x + 1, trigger.y));
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("TOOLS EXECUTION");
    expect(setup.captureCharFrame()).toContain("OK");
    expect(setup.captureCharFrame()).toContain("RUN");
    expect(setup.captureCharFrame()).toContain("file contents");
    expect(setup.captureCharFrame()).toContain("https://example.com");

    message = { ...message, entries: [...message.entries, { toolCallId: "shell", toolName: "shell", phase: "executing" }] };
    await setup.update(message);
    expect(setup.captureCharFrame()).toContain("TOOLS EXECUTION");
    expect(setup.captureCharFrame()).toContain("shell");

    await act(async () => setup.mockMouse.click(trigger.x + 1, trigger.y));
    await setup.renderOnce();
    expect(setup.captureCharFrame().trim()).toBe("shell");

    message = { ...message, entries: message.entries.map(entry => entry.toolCallId === "shell" ? { ...entry, phase: "error", detail: "command failed" } : entry) };
    await setup.update(message);
    expect(setup.captureCharFrame().trim()).toBe("webfetch");

    trigger.focus();
    await act(async () => setup.mockInput.pressEnter());
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("TOOLS EXECUTION");
    expect(setup.captureCharFrame()).toContain("ERR");
    expect(setup.captureCharFrame()).toContain("command failed");
    await act(async () => setup.mockInput.pressKey(" "));
    await setup.renderOnce();
    expect(setup.captureCharFrame().trim()).toBe("webfetch");

    await act(async () => setup.mockInput.pressEnter());
    await setup.renderOnce();
    await setup.update({ ...toolGroup(), id: "next-group" });
    expect(setup.captureCharFrame().trim()).toBe("webfetch");
  } finally {
    await setup.destroy();
  }
});

test("keeps completed summaries clickable and renders no trigger for empty groups", async () => {
  const message: ToolGroupMessage = {
    ...toolGroup(),
    collapsed: true,
    summary: { total: 2, success: 1, failed: 1, toolNames: ["read", "webfetch"] },
  };
  let opened: ToolGroupMessage[] = [];
  const setup = await renderToolMessage(toolGroup(), 80, groups => { opened = groups; });
  try {
    await setup.update(message);
    expect(setup.captureCharFrame().trim()).toBe("TOOLS 1/2 ▼");
    const trigger = setup.renderer.root.getChildren()[0]!;
    await act(async () => setup.mockMouse.click(trigger.x + 1, trigger.y));
    expect(opened).toEqual([message]);

    await setup.update({ ...toolGroup(), entries: [] });
    expect(setup.captureCharFrame().trim()).toBe("");
  } finally {
    await setup.destroy();
  }
});
