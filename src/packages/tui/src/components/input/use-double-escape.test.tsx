import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import { act, useState } from "react";
import { createRoot } from "@opentui/react";
import { createTestRenderer } from "@opentui/core/testing";
import { useDoubleEscape } from "./use-double-escape";

beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => {
  jest.useRealTimers();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = false;
});

test("double escape requires two presses inside two seconds and clears on idle", async () => {
  const setup = await createTestRenderer({ width: 20, height: 4 });
  const root = createRoot(setup.renderer);
  const hints: (string | null)[] = [];
  const actions: string[] = [];
  let api!: ReturnType<typeof useDoubleEscape>;
  let setBusy!: (busy: boolean) => void;

  function Harness() {
    const [busy, updateBusy] = useState(true);
    setBusy = updateBusy;
    api = useDoubleEscape({
      busy,
      onCancelTask: () => actions.push("cancel"),
      onCancelHint: hint => hints.push(hint),
    });
    return <box><text>{busy ? "busy" : "idle"}</text></box>;
  }

  try {
    await act(async () => root.render(<Harness />));
    await setup.renderOnce();
    jest.useFakeTimers();

    api.handleEscape();
    expect(hints).toEqual(["Press ESC again within 2s to cancel current task"]);
    expect(actions).toEqual([]);

    jest.advanceTimersByTime(2000);
    expect(hints).toEqual(["Press ESC again within 2s to cancel current task", null]);

    api.handleEscape();
    expect(hints.at(-1)).toBe("Press ESC again within 2s to cancel current task");
    api.handleEscape();
    expect(hints.at(-1)).toBe("Cancelling current task...");
    expect(actions).toEqual(["cancel"]);

    await act(async () => setBusy(false));
    expect(hints.at(-1)).toBeNull();
    await act(async () => setBusy(true));
    hints.length = 0;
    api.handleEscape();
    expect(hints).toEqual(["Press ESC again within 2s to cancel current task"]);
    expect(actions).toEqual(["cancel"]);

    await act(async () => setBusy(false));
    expect(hints.at(-1)).toBeNull();
  } finally {
    await act(async () => root.unmount());
    setup.renderer.destroy();
  }
});
