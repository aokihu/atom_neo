import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "@opentui/react";
import { createTestRenderer } from "@opentui/core/testing";
import type { KeyEvent, TextareaRenderable } from "@opentui/core";
import { useInputHistory } from "../../stores/inputHistory";
import { dispatchCommand, resolveCommand, useCommandMenu } from "./use-command-menu";

type Api = ReturnType<typeof useCommandMenu>;

const key = (name: string, patch: Partial<KeyEvent> = {}): KeyEvent => ({
  name,
  ctrl: false,
  meta: false,
  preventDefault() {},
  ...patch,
} as KeyEvent);

const fakeTextarea = () => {
  const element = {
    plainText: "",
    setText(text: string) { element.plainText = text; },
    replaceText(text: string) { element.plainText = text; },
  };
  return { current: element as unknown as TextareaRenderable } as { current: TextareaRenderable | null };
};

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  useInputHistory.setState({ history: [], historyIndex: -1, draft: "" });
});
afterEach(() => {
  useInputHistory.setState({ history: [], historyIndex: -1, draft: "" });
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = false;
});

async function mountHook() {
  const textarea = fakeTextarea();
  const setup = await createTestRenderer({ width: 20, height: 4 });
  const root = createRoot(setup.renderer);
  let api!: Api;
  function Harness() {
    api = useCommandMenu({ textarea, disabled: false });
    return <box><text>{api.content}</text></box>;
  }
  await act(async () => root.render(<Harness />));
  await setup.renderOnce();
  return {
    textarea,
    get api() { return api; },
    async update(fn: () => void) {
      await act(async () => fn());
      await setup.renderOnce();
    },
    async destroy() {
      await act(async () => root.unmount());
      setup.renderer.destroy();
    },
  };
}

describe("useCommandMenu", () => {
  test("tracks slash input, filters matches and fills selections", async () => {
    const ctx = await mountHook();
    try {
      (ctx.textarea.current as any).plainText = "/";
      await ctx.update(() => ctx.api.handleContentChange());
      expect(ctx.api.showMenu).toBe(true);
      expect(ctx.api.cmdMatches.map(command => command.name)).toEqual([
        "/quit", "/help", "/clear", "/compact", "/settings",
      ]);
      expect(ctx.api.content).toBe("/");

      await ctx.update(() => { ctx.api.handleMenuKey(key("down")); });
      expect(ctx.textarea.current!.plainText).toBe("/help");

      await ctx.update(() => ctx.api.handleContentChange());
      expect(ctx.api.content).toBe("/help");
      expect(ctx.api.cmdMatches).toHaveLength(5);

      await ctx.update(() => { ctx.api.handleMenuKey(key("tab")); });
      expect(ctx.textarea.current!.plainText).toBe("/help");
      await ctx.update(() => ctx.api.clearInput());
      expect(ctx.textarea.current!.plainText).toBe("");
      expect(ctx.api.content).toBe("");
      expect(ctx.api.showMenu).toBe(false);
    } finally {
      await ctx.destroy();
    }
  });

  test("resolves exact commands only", () => {
    expect(resolveCommand("/clear")?.name).toBe("/clear");
    expect(resolveCommand("/cl")).toBeNull();
    expect(resolveCommand("hello")).toBeNull();
  });

  test("dispatches every command to its handler", () => {
    const fired: string[] = [];
    const handlers = {
      onQuit: () => fired.push("quit"),
      onHelp: () => fired.push("help"),
      onClear: () => fired.push("clear"),
      onCompact: () => fired.push("compact"),
      onSettings: () => fired.push("settings"),
    };
    dispatchCommand("/quit", handlers);
    dispatchCommand("/help", handlers);
    dispatchCommand("/clear", handlers);
    dispatchCommand("/compact", handlers);
    dispatchCommand("/settings", handlers);
    dispatchCommand("/unknown", handlers);
    expect(fired).toEqual(["quit", "help", "clear", "compact", "settings"]);
  });

  test("navigates history and restores the draft", async () => {
    useInputHistory.setState({ history: ["first", "second"], historyIndex: -1, draft: "" });
    const ctx = await mountHook();
    try {
      (ctx.textarea.current as any).plainText = "draft";
      await ctx.update(() => ctx.api.handleContentChange());
      await ctx.update(() => { ctx.api.handleHistoryKey(key("up")); });
      expect(ctx.textarea.current!.plainText).toBe("first");
      expect(useInputHistory.getState().historyIndex).toBe(0);
      await ctx.update(() => { ctx.api.handleHistoryKey(key("up")); });
      expect(ctx.textarea.current!.plainText).toBe("second");
      expect(useInputHistory.getState().historyIndex).toBe(1);
      await ctx.update(() => { ctx.api.handleHistoryKey(key("down")); });
      expect(ctx.textarea.current!.plainText).toBe("first");
      await ctx.update(() => { ctx.api.handleHistoryKey(key("down")); });
      expect(ctx.textarea.current!.plainText).toBe("draft");
      expect(useInputHistory.getState().historyIndex).toBe(-1);
      expect(ctx.api.handleHistoryKey(key("up", { ctrl: true }))).toBe(false);
    } finally {
      await ctx.destroy();
    }
  });
});
