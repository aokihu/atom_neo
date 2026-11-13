import { afterEach, beforeEach, expect, test } from "bun:test";
import { act, createRef, useState, type Ref } from "react";
import { createRoot } from "@opentui/react";
import { createTestRenderer } from "@opentui/core/testing";
import { RGBA } from "@opentui/core";
import type { BoxRenderable } from "@opentui/core";
import { Modal } from "./Modal";
import type { ModalAction } from "./types";
import { getTheme } from "../theme";

const ACTIONS: ModalAction[] = [
  { key: "cancel", label: "Cancel", role: "cancel" },
  { key: "ok", label: "OK", role: "confirm", variant: "primary" },
];

beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); });
afterEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false }); });

async function mountModal({ listLength, focusRef }: { listLength?: number; focusRef?: Ref<BoxRenderable> } = {}) {
  const setup = await createTestRenderer({ width: 80, height: 24 });
  const root = createRoot(setup.renderer);
  const triggered: string[] = [];
  const listMoves: number[] = [];
  let setOpen!: (open: boolean) => void;

  function Harness() {
    const [open, setModalOpen] = useState(false);
    setOpen = setModalOpen;
    return (
      <Modal
        open={open}
        title="Test"
        width={48}
        actions={ACTIONS}
        defaultActionKey="ok"
        onAction={key => triggered.push(key)}
        onClose={() => {}}
        listLength={listLength}
        selectedListIndex={1}
        onListNavigate={index => listMoves.push(index)}
        onListActivate={index => triggered.push(`list:${index}`)}
        focusRef={focusRef}
        hint="↑/↓ select · Tab actions"
      />
    );
  }

  await act(async () => root.render(<Harness />));
  await setup.renderOnce();

  const render = async (open: boolean) => {
    await act(async () => setOpen(open));
    await setup.renderOnce();
  };

  const press = async (...keys: string[]) => {
    for (const key of keys) {
      await act(async () => setup.mockInput.pressKey(key));
      await setup.renderOnce();
    }
  };

  return { setup, root, triggered, listMoves, render, press };
}

async function cleanup(ctx: Awaited<ReturnType<typeof mountModal>>) {
  await act(async () => ctx.root.unmount());
  ctx.setup.renderer.destroy();
}

test("reopening resets the selected action to defaultActionKey", async () => {
  const ctx = await mountModal();
  try {
    await ctx.render(true);
    await ctx.press("RETURN");
    await ctx.press("ARROW_LEFT");
    await ctx.render(false);
    await ctx.render(true);
    await ctx.press("RETURN");
    expect(ctx.triggered).toEqual(["ok", "ok"]);
  } finally {
    await cleanup(ctx);
  }
});

test("right focuses actions without moving list selection and Enter triggers the action", async () => {
  const ctx = await mountModal({ listLength: 3 });
  try {
    await ctx.render(true);
    await ctx.press("ARROW_RIGHT");
    expect(ctx.listMoves).toEqual([]);
    await ctx.press("RETURN");
    expect(ctx.triggered).toEqual(["ok"]);
    expect(ctx.listMoves).toEqual([]);
  } finally {
    await cleanup(ctx);
  }
});

test("Tab focuses actions from list mode, then left/right cycle actions", async () => {
  const ctx = await mountModal({ listLength: 3 });
  try {
    await ctx.render(true);
    await ctx.press("ARROW_UP");
    expect(ctx.listMoves).toEqual([0]);
    await ctx.press("TAB");
    expect(ctx.listMoves).toEqual([0]);
    await ctx.press("RETURN");
    expect(ctx.triggered).toEqual(["ok"]);
    await ctx.press("ARROW_LEFT", "RETURN");
    expect(ctx.triggered).toEqual(["ok", "cancel"]);
  } finally {
    await cleanup(ctx);
  }
});

test("renders the hint when provided", async () => {
  const ctx = await mountModal();
  try {
    await ctx.render(true);
    expect(ctx.setup.captureCharFrame()).toContain("↑/↓ select · Tab actions");
  } finally {
    await cleanup(ctx);
  }
});

test("focusRef makes the modal panel the focused renderable", async () => {
  const focusRef = createRef<BoxRenderable>();
  const ctx = await mountModal({ focusRef });
  try {
    await ctx.render(true);
    await act(async () => focusRef.current?.focus());
    expect(ctx.setup.renderer.currentFocusedRenderable).toBe(focusRef.current);
    await ctx.render(false);
    expect(ctx.setup.renderer.currentFocusedRenderable).toBeNull();
  } finally {
    await cleanup(ctx);
  }
});

test("draws a panel border and highlights the selected action border", async () => {
  const ctx = await mountModal();
  try {
    await ctx.render(true);
    const frame = ctx.setup.captureCharFrame();
    expect(frame).toContain("┌");
    const selected = ctx.setup.renderer.root.findDescendantById("modal-action-ok") as BoxRenderable;
    const unselected = ctx.setup.renderer.root.findDescendantById("modal-action-cancel") as BoxRenderable;
    const { colors } = getTheme();
    expect(selected.border).toBe(true);
    expect(unselected.border).toBe(false);
    expect(selected.borderColor.equals(RGBA.fromHex(colors.accent.brand))).toBe(true);
  } finally {
    await cleanup(ctx);
  }
});
