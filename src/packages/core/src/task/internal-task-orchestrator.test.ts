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
});
