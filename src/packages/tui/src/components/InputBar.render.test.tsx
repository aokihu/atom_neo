import { afterEach, beforeEach, expect, test } from "bun:test";
import { act, createRef, useState } from "react";
import { createRoot } from "@opentui/react";
import { createTestRenderer } from "@opentui/core/testing";
import type { TextareaRenderable } from "@opentui/core";
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
  const inputRef = createRef<TextareaRenderable>();
  useChatStore.setState({ busy });
  await act(async () => root.render(<InputBar inputRef={inputRef} onSend={() => {}} />));
  await setup.renderOnce();
  return { setup, root, inputRef };
}

test("INPUT renders the command frame and a three-line placeholder when ready", async () => {
  const { setup, root, inputRef } = await renderInputBar(false);
  try {
    const frame = setup.captureCharFrame();
    expect(frame).toContain("COMMAND");
    expect(frame).toContain("READY");
    expect(frame).toContain("Type a message...");
    expect(frame).not.toContain("LOCKED");
    expect(frame).not.toContain("Commands");
    expect(inputRef.current?.height).toBe(3);
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

test("INPUT keeps its draft while a modal disables the input", async () => {
  const setup = await createTestRenderer({ width: 80, height: 12 });
  const root = createRoot(setup.renderer);
  const inputRef = createRef<TextareaRenderable>();
  let setDisabled!: (value: boolean) => void;
  function Harness() {
    const [disabled, set] = useState(false);
    setDisabled = set;
    return <InputBar inputRef={inputRef} onSend={() => {}} disabled={disabled} />;
  }
  try {
    await act(async () => root.render(<Harness />));
    await setup.renderOnce();
    await act(async () => inputRef.current?.setText("draft text"));
    await act(async () => setDisabled(true));
    await setup.renderOnce();
    expect(inputRef.current?.plainText).toBe("draft text");
    await act(async () => setDisabled(false));
    await setup.renderOnce();
    expect(inputRef.current?.plainText).toBe("draft text");
  } finally {
    await act(async () => root.unmount());
    setup.renderer.destroy();
  }
});
