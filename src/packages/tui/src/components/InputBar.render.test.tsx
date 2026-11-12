import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "@opentui/react";
import { createTestRenderer } from "@opentui/core/testing";
import { InputBar } from "./InputBar";
import { useChatStore } from "../stores/chat";

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  useChatStore.setState({ busy: false });
});
afterEach(() => {
  useChatStore.setState({ busy: false });
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = false;
});

async function renderInputBar(busy: boolean) {
  const setup = await createTestRenderer({ width: 80, height: 12 });
  const root = createRoot(setup.renderer);
  useChatStore.setState({ busy });
  await act(async () => root.render(<InputBar onSend={() => {}} />));
  await setup.renderOnce();
  return { setup, root };
}

test("INPUT renders the command frame and placeholder when ready", async () => {
  const { setup, root } = await renderInputBar(false);
  try {
    const frame = setup.captureCharFrame();
    expect(frame).toContain("COMMAND");
    expect(frame).toContain("READY");
    expect(frame).toContain("Type a message...");
    expect(frame).not.toContain("LOCKED");
    expect(frame).not.toContain("Commands");
  } finally {
    await act(async () => root.unmount());
    setup.renderer.destroy();
  }
});

test("INPUT reports a locked session while a task is running", async () => {
  const { setup, root } = await renderInputBar(true);
  try {
    const frame = setup.captureCharFrame();
    expect(frame).toContain("COMMAND");
    expect(frame).toContain("LOCKED");
    expect(frame).not.toContain("READY");
  } finally {
    await act(async () => root.unmount());
    setup.renderer.destroy();
  }
});
