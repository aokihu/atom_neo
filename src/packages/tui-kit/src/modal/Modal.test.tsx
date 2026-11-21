import { afterEach, beforeEach, expect, test } from "bun:test";
import { act, createRef, useState, type ReactNode, type Ref } from "react";
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

async function mountModal({ listLength, focusRef, actions = ACTIONS, headerRight, title = "Test", titleTruncate, width = 48, hint = "↑/↓ select · Tab actions", hintTruncate, breadcrumb }: {
  listLength?: number;
  focusRef?: Ref<BoxRenderable>;
  actions?: ModalAction[];
  headerRight?: ReactNode;
  title?: string;
  titleTruncate?: boolean;
  width?: number;
  hint?: string;
  hintTruncate?: boolean;
  breadcrumb?: string;
} = {}) {
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
        title={title}
        breadcrumb={breadcrumb}
        headerRight={headerRight}
        titleTruncate={titleTruncate}
        width={width}
        actions={actions}
        defaultActionKey="ok"
        onAction={key => triggered.push(key)}
        onClose={() => {}}
        listLength={listLength}
        selectedListIndex={1}
        onListNavigate={index => listMoves.push(index)}
        onListActivate={index => triggered.push(`list:${index}`)}
        focusRef={focusRef}
        hint={hint}
        hintTruncate={hintTruncate}
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

test("renders headerRight on the title row", async () => {
  const ctx = await mountModal({ headerRight: <text fg="#888888">v9.9.9</text> });
  try {
    await ctx.render(true);
    const lines = ctx.setup.captureCharFrame().split("\n");
    const line = lines.find(value => value.includes("Test") && value.includes("v9.9.9"));
    expect(line).toBeDefined();
    expect(line!.indexOf("v9.9.9")).toBeGreaterThan(line!.indexOf("Test"));
    expect(line!.replace(/[│]/g, "").trimEnd().endsWith("v9.9.9")).toBe(true);
    expect(lines.filter(value => value.includes("v9.9.9"))).toHaveLength(1);
  } finally {
    await cleanup(ctx);
  }
});

test("keeps the original wrapping behavior when headerRight and titleTruncate are absent", async () => {
  const title = "Header compatibility title that keeps the original wrapping behavior";
  const ctx = await mountModal({ title, width: 24 });
  try {
    await ctx.render(true);
    const frame = ctx.setup.captureCharFrame();
    expect(frame).not.toContain("…");
    const titleLines = frame.split("\n").filter(line => /Header|compatibility|wrapping|behavior/.test(line));
    expect(titleLines.length).toBeGreaterThan(1);
  } finally {
    await cleanup(ctx);
  }
});

test("titleTruncate opts into single-line ellipsis without headerRight", async () => {
  const ctx = await mountModal({ title: "A very long title that must be truncated", titleTruncate: true, width: 24 });
  try {
    await ctx.render(true);
    const frame = ctx.setup.captureCharFrame();
    expect(frame).toContain("...");
    expect(frame).not.toContain("A very long title that must be truncated");
  } finally {
    await cleanup(ctx);
  }
});

test("renders breadcrumb only when explicitly provided", async () => {
  const withCrumb = await mountModal({ breadcrumb: "Home / Configure / Gateway" });
  try {
    await withCrumb.render(true);
    expect(withCrumb.setup.captureCharFrame()).toContain("Home / Configure / Gateway");
  } finally {
    await cleanup(withCrumb);
  }
  const withoutCrumb = await mountModal();
  try {
    await withoutCrumb.render(true);
    expect(withoutCrumb.setup.captureCharFrame()).not.toContain("Home / Configure / Gateway");
  } finally {
    await cleanup(withoutCrumb);
  }
});

test("breadcrumb truncates on one line without colliding with the title version", async () => {
  const ctx = await mountModal({
    title: "Gateway",
    titleTruncate: true,
    headerRight: <text fg="#888888">v9.9.9</text>,
    breadcrumb: "Home / Configure / Gateway / Very Long Parent Context",
    width: 40,
  });
  try {
    await ctx.render(true);
    const lines = ctx.setup.captureCharFrame().split("\n");
    const crumbs = lines.filter(line => line.includes("Home /"));
    expect(crumbs).toHaveLength(1);
    expect(crumbs[0]).toContain("Home /");
    expect(crumbs[0]).toContain("Parent Context");
    expect(crumbs[0]).not.toContain("Very Long Parent Context");
    expect(lines.filter(line => line.includes("v9.9.9"))).toHaveLength(1);
  } finally {
    await cleanup(ctx);
  }
});

test("wraps a long hint by default at narrow width", async () => {
  const hint = "This deliberately long hint must wrap on a narrow terminal";
  const ctx = await mountModal({ hint, width: 40 });
  try {
    await ctx.render(true);
    const lines = ctx.setup.captureCharFrame().split("\n");
    const hintLines = lines.filter(line => /This|deliberately|must|wrap|narrow|terminal/.test(line));
    expect(hintLines.length).toBeGreaterThan(1);
  } finally {
    await cleanup(ctx);
  }
});

test("hintTruncate makes a long hint single-line without losing the header version", async () => {
  const hint = "This deliberately long hint must remain on one truncated line";
  const ctx = await mountModal({
    hint,
    hintTruncate: true,
    width: 40,
    title: "A very long modal title that needs truncation",
    titleTruncate: true,
    headerRight: <text fg="#888888">v9.9.9</text>,
  });
  try {
    await ctx.render(true);
    const lines = ctx.setup.captureCharFrame().split("\n");
    const hintLines = lines.filter(line => /This|deliberately|remain|truncated/.test(line));
    expect(hintLines).toHaveLength(1);
    const title = lines.find(line => line.includes("v9.9.9"));
    expect(title?.trimEnd().replace(/[│]/g, "").trimEnd().endsWith("v9.9.9")).toBe(true);
    const version = title!.indexOf("v9.9.9");
    expect(title![version - 1]).toBe(" ");
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
    expect(unselected.border).toBe(true);
    expect(selected.borderColor.equals(RGBA.fromHex(colors.accent.brand))).toBe(true);
    expect(unselected.borderColor.equals(RGBA.fromHex(colors.bg.popup))).toBe(true);
  } finally {
    await cleanup(ctx);
  }
});

test("even-length labels center within a six-cell content width", async () => {
  const ctx = await mountModal();
  try {
    await ctx.render(true);
    const label = ctx.setup.renderer.root.findDescendantById("modal-action-label-ok") as BoxRenderable;
    expect(label.width).toBe(6);
  } finally {
    await cleanup(ctx);
  }
});

test("odd-length labels center within a seven-cell content width", async () => {
  const ctx = await mountModal({ actions: [{ key: "run", label: "Run" }] });
  try {
    await ctx.render(true);
    const label = ctx.setup.renderer.root.findDescendantById("modal-action-label-run") as BoxRenderable;
    expect(label.width).toBe(7);
  } finally {
    await cleanup(ctx);
  }
});
