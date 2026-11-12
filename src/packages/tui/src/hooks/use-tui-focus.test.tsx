import { afterEach, beforeEach, expect, test } from "bun:test";
import { act, createRef, useState } from "react";
import { createRoot } from "@opentui/react";
import { createTestRenderer } from "@opentui/core/testing";
import type { BoxRenderable } from "@opentui/core";
import { useTuiFocus } from "./use-tui-focus";

beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); });
afterEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false }); });

async function mount() {
  const setup = await createTestRenderer({ width: 80, height: 24 });
  const root = createRoot(setup.renderer);
  const otherRef = createRef<BoxRenderable>();
  let refs!: ReturnType<typeof useTuiFocus>;
  let setModalOpen!: (open: boolean) => void;

  function Harness() {
    const [open, setOpen] = useState(false);
    setModalOpen = setOpen;
    refs = useTuiFocus(open);
    return (
      <>
        <textarea ref={refs.inputRef} height={1} />
        <box ref={otherRef} focusable height={1} />
        <box ref={refs.modalFocusRef} focusable={open} height={1} />
      </>
    );
  }

  await act(async () => root.render(<Harness />));
  await setup.renderOnce();

  const render = async (open: boolean) => {
    await act(async () => setModalOpen(open));
    await setup.renderOnce();
  };
  const emitTerminalFocus = async () => {
    await act(async () => { setup.renderer.emit("focus"); });
    await setup.renderOnce();
  };
  const cleanup = async () => {
    await act(async () => root.unmount());
    setup.renderer.destroy();
  };

  return { setup, refs: () => refs, otherRef, render, emitTerminalFocus, cleanup };
}

test("terminal activation returns focus to the input unless a modal is open", async () => {
  const ctx = await mount();
  try {
    expect(ctx.setup.renderer.currentFocusedRenderable).toBe(ctx.refs().inputRef.current);
    await act(async () => ctx.otherRef.current?.focus());
    expect(ctx.setup.renderer.currentFocusedRenderable).toBe(ctx.otherRef.current);
    await ctx.emitTerminalFocus();
    expect(ctx.setup.renderer.currentFocusedRenderable).toBe(ctx.refs().inputRef.current);

    await ctx.render(true);
    expect(ctx.setup.renderer.currentFocusedRenderable).toBe(ctx.refs().modalFocusRef.current);
    await act(async () => ctx.otherRef.current?.focus());
    await ctx.emitTerminalFocus();
    expect(ctx.setup.renderer.currentFocusedRenderable).toBe(ctx.refs().modalFocusRef.current);
  } finally {
    await ctx.cleanup();
  }
});

test("closing a modal restores input focus", async () => {
  const ctx = await mount();
  try {
    await ctx.render(true);
    expect(ctx.setup.renderer.currentFocusedRenderable).toBe(ctx.refs().modalFocusRef.current);
    await ctx.render(false);
    expect(ctx.setup.renderer.currentFocusedRenderable).toBe(ctx.refs().inputRef.current);
  } finally {
    await ctx.cleanup();
  }
});
