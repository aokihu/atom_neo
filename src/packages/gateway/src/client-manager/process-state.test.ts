/** Process state machine transition tests. */
import { describe, expect, test } from "bun:test";
import { nextProcessState } from "./process-state";
import type { ProcessEvent, ProcessState } from "./process-state";

describe("nextProcessState", () => {
  test("walks the normal lifecycle from idle back to idle", () => {
    let state: ProcessState = "idle";
    for (const event of [{ type: "start" }, { type: "ready" }, { type: "stop" }, { type: "exit", intentional: true }] as ProcessEvent[]) {
      state = nextProcessState(state, event);
    }
    expect(state).toBe("idle");
  });

  test("restarts through failed after an unexpected exit", () => {
    expect(nextProcessState("running", { type: "exit", intentional: false })).toBe("failed");
    expect(nextProcessState("failed", { type: "start" })).toBe("starting");
  });

  test("treats health failure like an unexpected exit", () => {
    expect(nextProcessState("running", { type: "health_failed" })).toBe("failed");
  });

  test("keeps spawned and duplicate start events in starting", () => {
    expect(nextProcessState("starting", { type: "spawned" })).toBe("starting");
    expect(nextProcessState("starting", { type: "start" })).toBe("starting");
    expect(nextProcessState("running", { type: "start" })).toBe("running");
  });

  test("allows duplicate stop while stopping", () => {
    expect(nextProcessState("stopping", { type: "stop" })).toBe("stopping");
    expect(nextProcessState("stopping", { type: "exit", intentional: true })).toBe("idle");
  });

  test("rejects start while stopping", () => {
    expect(() => nextProcessState("stopping", { type: "start" })).toThrow("Invalid process transition: stopping -> start");
  });

  test("rejects ready before start", () => {
    expect(() => nextProcessState("idle", { type: "ready" })).toThrow("Invalid process transition: idle -> ready");
  });

  test("enters failed from starting or stopping on an unexpected exit", () => {
    expect(nextProcessState("starting", { type: "stop" })).toBe("stopping");
    expect(nextProcessState("starting", { type: "exit", intentional: false })).toBe("failed");
    expect(nextProcessState("starting", { type: "health_failed" })).toBe("failed");
    expect(nextProcessState("stopping", { type: "exit", intentional: false })).toBe("failed");
  });

  test("reset returns every state to idle", () => {
    for (const state of ["idle", "starting", "running", "stopping", "failed"] as ProcessState[]) {
      expect(nextProcessState(state, { type: "reset" })).toBe("idle");
    }
  });

  test("give_up settles failed into idle via stop or reset", () => {
    expect(nextProcessState("failed", { type: "stop" })).toBe("idle");
    expect(nextProcessState("failed", { type: "reset" })).toBe("idle");
  });
});
