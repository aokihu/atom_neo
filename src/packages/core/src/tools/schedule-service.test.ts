import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Logger, sleep } from "@atom-neo/shared";
import type { ScheduledTask } from "@atom-neo/shared";
import { ScheduleService } from "./schedule-service";
import type { TaskQueue } from "../task-queue";

const logger = new Logger("error", () => {});
const queue = { enqueue: () => {} } as unknown as TaskQueue;
const base = { sessionId: "session-1", chatId: "chat-1", prompt: "tick" };

describe("ScheduleService cron jobs", () => {
  let dir: string | undefined;
  let service: ScheduleService | undefined;

  function createService(): ScheduleService {
    dir = mkdtempSync(join(tmpdir(), "atom-schedule-"));
    service = new ScheduleService(queue, join(dir, "tasks.json"), logger);
    return service;
  }

  afterEach(() => {
    service?.stop();
    service = undefined;
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  test("computes the next cron run with croner", () => {
    const svc = createService();
    const before = Date.now();
    const task = svc.create({ ...base, name: "cron", type: "cron", schedule: "*/2 * * * * *" });

    expect(task.nextFireAt).toBeDefined();
    expect(task.nextFireAt!).toBeGreaterThanOrEqual(before);
    expect(task.nextFireAt! - before).toBeLessThanOrEqual(2_100);
    expect(task.nextFireAt! % 2_000).toBe(0);
  });

  test("fires a cron job and records the run", async () => {
    const svc = createService();
    const fired: ScheduledTask[] = [];
    const task = svc.create({
      ...base,
      name: "tick",
      type: "cron",
      schedule: "* * * * * *",
      onFire: (firedTask) => fired.push(firedTask),
    });

    const deadline = Date.now() + 2_500;
    while (fired.length === 0 && Date.now() < deadline) await sleep(25);

    expect(fired).toHaveLength(1);
    expect(fired[0].id).toBe(task.id);
    expect(typeof task.lastFiredAt).toBe("number");
  });

  test("stops cron jobs on service stop", async () => {
    const svc = createService();
    const fired: ScheduledTask[] = [];
    svc.create({
      ...base,
      name: "stopped",
      type: "cron",
      schedule: "* * * * * *",
      onFire: (task) => fired.push(task),
    });

    svc.stop();
    await sleep(1_200);

    expect(fired).toHaveLength(0);
  });

  test("disables a task with an invalid cron expression", () => {
    const svc = createService();
    const task = svc.create({ ...base, name: "invalid", type: "cron", schedule: "not a cron" });

    expect(task.enabled).toBe(false);
  });
});
