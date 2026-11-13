import { afterEach, beforeEach, expect, test } from "bun:test";
import { act, createRef, useState } from "react";
import { createRoot } from "@opentui/react";
import { createTestRenderer } from "@opentui/core/testing";
import { RGBA } from "@opentui/core";
import type { BoxRenderable, TextareaRenderable } from "@opentui/core";
import { getTheme } from "@atom-neo/tui-kit";
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

test("INPUT renders the minimal prompt box without header rows", async () => {
  const { setup, root } = await renderInputBar(false);
  try {
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Type a message...");
    expect(frame).not.toContain("COMMAND");
    expect(frame).not.toContain("READY");
    expect(frame).not.toContain("LOCKED");
    expect(frame).not.toContain("Commands");
    const bar = setup.renderer.root.findDescendantById("input-bar") as BoxRenderable;
    expect(bar.height).toBe(7);
    expect(bar.borderColor.equals(RGBA.fromHex(getTheme().colors.decoration.subtle))).toBe(true);
  } finally {
    await act(async () => root.unmount());
    setup.renderer.destroy();
  }
});

test("INPUT uses a warning border while a task is running", async () => {
  const { setup, root } = await renderInputBar(true);
  try {
    const bar = setup.renderer.root.findDescendantById("input-bar") as BoxRenderable;
    expect(bar.borderColor.equals(RGBA.fromHex(getTheme().colors.status.warning))).toBe(true);
    expect(setup.captureCharFrame()).not.toContain("LOCKED");
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
