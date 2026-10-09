import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "@opentui/react";
import { createTestRenderer } from "@opentui/core/testing";
import type { ScrollBoxRenderable } from "@opentui/core";
import { RoundsSection, TodoSection } from "./Sidebar";
import { useChatStore } from "../stores/chat";
import type { TodoItem } from "../types";

const todos = (active: number, count = 10): TodoItem[] => Array.from({ length: count }, (_, index) => ({
  content: `第${index + 1}项：文明发展的历史与社会变迁，需要保留完整文字并正确换行。`,
  status: index === active ? "in_progress" : index < active ? "completed" : "pending",
  priority: "medium",
}));
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => {
  useChatStore.setState({ todoItems: [], rounds: null, telemetryOnline: false });
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = false;
});

test("TODO follows wrapped active rows, preserves manual scroll, and supports keyboard and mouse", async () => {
  const setup = await createTestRenderer({ width: 30, height: 30 });
  const root = createRoot(setup.renderer);
  try {
    useChatStore.setState({ telemetryOnline: true, todoItems: todos(8) });
    await act(async () => root.render(<box width="100%"><TodoSection /></box>));
    await setup.renderOnce();
    await setup.renderOnce();
    const scroll = setup.renderer.root.findDescendantById("todo-scroll") as ScrollBoxRenderable;
    expect(scroll.content.getChildren()).toHaveLength(10);
    expect(scroll.scrollTop).toBeGreaterThan(0);
    expect(setup.captureCharFrame()).toContain("✅8");
    expect(setup.captureCharFrame()).toContain("⌛1");
    expect(setup.captureCharFrame()).toContain("▶ 9 / 10");
    expect(setup.captureCharFrame()).not.toContain("PENDING");
    expect(setup.captureCharFrame()).not.toContain("NO ACTIVE ITEM");
    const summary = setup.captureCharFrame().split("\n").find(line => line.includes("✅8"))!;
    expect(summary).toContain("⌛1");
    expect(summary).toContain("▶1");
    expect(summary).toContain("✕0");
    const row = scroll.getRenderable("todo-row-8")!;
    expect(row.height).toBeGreaterThan(1);
    expect(row.y).toBeGreaterThanOrEqual(scroll.viewport.y);
    expect(row.y + row.height).toBeLessThanOrEqual(scroll.viewport.y + scroll.viewport.height);

    scroll.scrollTop = 0;
    await act(async () => useChatStore.setState({ todoItems: todos(8) }));
    await setup.renderOnce();
    expect(scroll.scrollTop).toBe(0);
    setup.mockInput.pressKey("ARROW_DOWN", { meta: true });
    await setup.renderOnce();
    expect(scroll.scrollTop).toBeGreaterThan(0);
    const beforeMouse = scroll.scrollTop;
    await setup.mockMouse.scroll(scroll.viewport.x + 2, scroll.viewport.y + 2, "down");
    await setup.renderOnce();
    expect(scroll.scrollTop).toBeGreaterThan(beforeMouse);

    await act(async () => useChatStore.setState({ todoItems: todos(5) }));
    await setup.renderOnce();
    await setup.renderOnce();
    const next = scroll.getRenderable("todo-row-5")!;
    expect(next.y).toBeGreaterThanOrEqual(scroll.viewport.y);
    expect(next.y + next.height).toBeLessThanOrEqual(scroll.viewport.y + scroll.viewport.height);
    const beforeResizeHeight = next.height;
    setup.resize(20, 30);
    await setup.renderOnce();
    await setup.renderOnce();
    expect(next.y).toBeGreaterThanOrEqual(scroll.viewport.y);
    expect(next.y + next.height).toBeLessThanOrEqual(scroll.viewport.y + scroll.viewport.height);
    expect(next.height).toBeGreaterThan(beforeResizeHeight);

    await act(async () => useChatStore.setState({ todoItems: todos(2, 5) }));
    await setup.renderOnce();
    expect(setup.renderer.root.findDescendantById("todo-scroll")).toBeUndefined();
  } finally {
    await act(async () => root.unmount());
    setup.renderer.destroy();
  }
});

test("ROUNDS reflects actual allowance and window state, then clears on disconnect", async () => {
  const setup = await createTestRenderer({ width: 30, height: 12 });
  const root = createRoot(setup.renderer);
  try {
    useChatStore.setState({ telemetryOnline: true, rounds: { goalId: "g", globalUsed: 100, globalAllowance: 100, localUsed: 5, localLimit: 5, pause: "global_limit" } });
    await act(async () => root.render(<box width={30}><RoundsSection /></box>));
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("ROUNDS");
    expect(setup.captureCharFrame()).toContain("100 / 100");
    expect(setup.captureCharFrame()).toContain("PAUSED · LIMIT");
    expect(setup.captureCharFrame()).toContain("WINDOW");
    await act(async () => useChatStore.setState({ rounds: { goalId: "g", globalUsed: 100, globalAllowance: 200, localUsed: 5, localLimit: 5, pause: "health_check" } }));
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("100 / 200");
    expect(setup.captureCharFrame()).toContain("CHECKING");
    await act(async () => useChatStore.setState({ rounds: { goalId: "g", globalUsed: 100, globalAllowance: 200, localUsed: 5, localLimit: 5, completed: true } }));
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("0 / 200");
    expect(setup.captureCharFrame()).toContain("0 / 5");
    expect(setup.captureCharFrame()).not.toContain("█");
    expect(useChatStore.getState().rounds?.globalUsed).toBe(100);
    await act(async () => useChatStore.setState({ telemetryOnline: false, rounds: null }));
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("OFFLINE");
    expect(setup.captureCharFrame()).not.toContain("100 / 200");
  } finally {
    await act(async () => root.unmount());
    setup.renderer.destroy();
  }
});

test("completed TODOs use one summary row and do not imply target completion", async () => {
  const setup = await createTestRenderer({ width: 30, height: 30 });
  const root = createRoot(setup.renderer);
  try {
    useChatStore.setState({ telemetryOnline: true, todoItems: todos(10), rounds: { goalId: "g", globalUsed: 18, globalAllowance: 100, localUsed: 3, localLimit: 5 } });
    await act(async () => root.render(<box width={30}><RoundsSection /><TodoSection /></box>));
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("18 / 100");
    expect(setup.captureCharFrame()).toContain("≡ 10");
    expect(setup.captureCharFrame()).toContain("✅10");
    expect(setup.captureCharFrame()).not.toContain("NO ACTIVE ITEM");
  } finally {
    await act(async () => root.unmount());
    setup.renderer.destroy();
  }
});

test("attempted or failed todowrite cannot replace the authoritative plan", () => {
  const saved = todos(0);
  useChatStore.setState({ todoItems: saved });
  useChatStore.getState().handleToolEvent({ name: "todowrite", callId: "invalid", input: { todos: [] } });
  useChatStore.getState().handleToolEvent({ name: "todowrite", callId: "invalid", error: "validation failed" });
  expect(useChatStore.getState().todoItems).toEqual(saved);
});
