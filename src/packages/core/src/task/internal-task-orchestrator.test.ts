import { describe, expect, test } from "bun:test";
import { InternalTaskOrchestrator } from "./internal-task-orchestrator";

const createOrchestrator = () => {
  const tasks: any[] = [];
  const queue = { enqueue: (task: any) => tasks.push(task) };
  const bus = { emit: () => {} };
  return { orchestrator: new InternalTaskOrchestrator(queue as any, bus as any), tasks };
};

describe("InternalTaskOrchestrator continuations", () => {
  test("uses the interrupted-output prompt for follow-up", () => {
    const { orchestrator, tasks } = createOrchestrator();

    orchestrator.scheduleFollowUp("s1", "c1", "t1");

    expect(tasks[0].pipeline).toBe("conversation");
    expect(tasks[0].payload[0].data).toContain("上次中断处继续");
  });

  test("uses the plan-progress prompt for TODO continuation", () => {
    const { orchestrator, tasks } = createOrchestrator();

    orchestrator.scheduleTodoContinuation("s1", "c1", "t1");

    expect(tasks[0].pipeline).toBe("conversation");
    expect(tasks[0].payload[0].data).toContain("继续执行当前 TODO");
    expect(tasks[0].payload[0].data).not.toContain("上次中断处继续");
  });

  test("releases staged downstream tasks only after the parent commits", () => {
    const { orchestrator, tasks } = createOrchestrator();
    orchestrator.beginTask({ id: "parent" } as any);
    orchestrator.scheduleConversation("s1", "c1", "parent", undefined, undefined, "parent");

    expect(tasks).toHaveLength(0);
    expect(orchestrator.commitTask("parent")).toBe(true);
    expect(tasks).toHaveLength(1);
  });

  test("reports a terminal commit when no downstream task was staged", () => {
    const { orchestrator, tasks } = createOrchestrator();
    orchestrator.beginTask({ id: "terminal" } as any);

    expect(orchestrator.commitTask("terminal")).toBe(false);
    expect(tasks).toHaveLength(0);
  });

  test("discards staged downstream tasks when the parent checkpoint fails", () => {
    const { orchestrator, tasks } = createOrchestrator();
    orchestrator.beginTask({ id: "parent" } as any);
    orchestrator.scheduleCompress("s1", "c1", "parent", undefined, "parent");

    orchestrator.discardTask("parent");
    expect(tasks).toHaveLength(0);
  });

  test("discards every staged owner in the matching session task chain", () => {
    const { orchestrator, tasks } = createOrchestrator();
    orchestrator.beginTask({ id: "owner-1", chainId: "chain", sessionId: "s1" } as any);
    orchestrator.beginTask({ id: "owner-2", chainId: "chain", sessionId: "s1" } as any);
    orchestrator.beginTask({ id: "other-session", chainId: "chain", sessionId: "s2" } as any);
    orchestrator.scheduleConversation("s1", "c1", "root", undefined, undefined, "owner-1");
    orchestrator.schedulePostConversation("s1", "c1", "root", "owner-2");
    orchestrator.scheduleConversation("s2", "c1", "root", undefined, undefined, "other-session");

    orchestrator.discardChain("chain", "s1");
    expect(() => orchestrator.scheduleFollowUp("s1", "c1", "root", "owner-1"))
      .toThrow("Task owner is not active: owner-1");
    orchestrator.commitTask("owner-1");
    orchestrator.commitTask("owner-2");
    orchestrator.commitTask("other-session");

    expect(tasks).toHaveLength(1);
    expect(tasks[0].sessionId).toBe("s2");
  });

  test("does not stage an independent compact request under the active task", () => {
    const { orchestrator, tasks } = createOrchestrator();
    orchestrator.beginTask({ id: "parent" } as any);

    orchestrator.scheduleCompress("s1", "c1", "manual");
    orchestrator.discardTask("parent");

    expect(tasks).toHaveLength(1);
    expect(tasks[0].parentTaskId).toBe("manual");
  });

  test("propagates Hook origin to staged continuation tasks", () => {
    const { orchestrator, tasks } = createOrchestrator();
    orchestrator.beginTask({ id: "parent", chainId: "root", origin: { type: "hook", hookId: "hook-1" } } as any);
    orchestrator.scheduleFollowUp("s1", "c1", "parent", "parent");

    orchestrator.commitTask("parent");
    expect(tasks[0].origin).toEqual({ type: "hook", hookId: "hook-1" });
    expect(tasks[0].chainId).toBe("root");
  });

  test("rejects an explicit owner that is no longer active", () => {
    const { orchestrator, tasks } = createOrchestrator();

    expect(() => orchestrator.scheduleFollowUp("s1", "c1", "root", "missing"))
      .toThrow("Task owner is not active: missing");
    expect(() => orchestrator.scheduleFollowUp("s1", "c1", "root", ""))
      .toThrow("Task owner is not active:");
    expect(tasks).toHaveLength(0);
  });
});
