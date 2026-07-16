import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { TaskSource } from "@atom-neo/shared";
import type { ScheduledTask, Logger } from "@atom-neo/shared";
import type { TaskQueue } from "../task-queue";
import { createTaskItem } from "../task-factory";

interface CronJob {
  stop(): void;
  ref(): void;
  unref(): void;
}

type TimerHandle = ReturnType<typeof setTimeout>;

let nextScheduleId = 0;

function generateId(): string {
  return `schedule-${Date.now()}-${nextScheduleId++}`;
}

export class ScheduleService {
  #queue: TaskQueue;
  #persistPath: string;
  #logger: Logger;
  #tasks = new Map<string, ScheduledTask>();
  #jobs = new Map<string, CronJob>();
  #timers = new Map<string, TimerHandle>();
  #stopped = false;

  constructor(queue: TaskQueue, persistPath: string, logger: Logger) {
    this.#queue = queue;
    this.#persistPath = persistPath;
    this.#logger = logger;
  }

  create(task: {
    name: string;
    type?: ScheduledTask["type"];
    schedule?: string;
    delayMs?: number;
    intervalMs?: number;
    sessionId: string;
    chatId: string;
    prompt: string;
    enabled?: boolean;
    onFire?: (task: ScheduledTask) => void;
  }): ScheduledTask {
    const now = Date.now();
    const type = task.type ?? "cron";
    const schedule = task.schedule ?? "";
    const delayMs = task.delayMs ?? 0;
    const intervalMs = task.intervalMs ?? 0;
    const nextFireAt = type === "delay" ? now + delayMs : type === "interval" ? now + intervalMs : Bun.cron.parse(schedule)?.getTime();

    const record: ScheduledTask = {
      id: generateId(),
      name: task.name,
      type,
      schedule,
      delayMs,
      intervalMs,
      sessionId: task.sessionId,
      chatId: task.chatId,
      prompt: task.prompt,
      enabled: task.enabled ?? true,
      onFire: task.onFire,
      createdAt: now,
      updatedAt: now,
      nextFireAt,
    };
    this.#tasks.set(record.id, record);
    if (record.enabled && !this.#stopped) this.#startJob(record);
    this.#persist();
    this.#logger.info("schedule task created", { id: record.id, name: record.name, type, schedule, delayMs, intervalMs });
    return record;
  }

  list(filter?: { enabled?: boolean }): ScheduledTask[] {
    const all = [...this.#tasks.values()];
    if (filter?.enabled !== undefined) {
      return all.filter(t => t.enabled === filter.enabled);
    }
    return all;
  }

  get(id: string): ScheduledTask | undefined {
    return this.#tasks.get(id);
  }

  update(id: string, changes: Partial<Pick<ScheduledTask, "schedule" | "delayMs" | "intervalMs" | "prompt" | "enabled" | "type">>): ScheduledTask {
    const task = this.#tasks.get(id);
    if (!task) throw new Error(`Scheduled task "${id}" not found`);

    const wasEnabled = task.enabled;
    const scheduleChanged = changes.schedule !== undefined || changes.delayMs !== undefined || changes.intervalMs !== undefined || changes.type !== undefined;

    if (changes.schedule !== undefined) task.schedule = changes.schedule;
    if (changes.delayMs !== undefined) task.delayMs = changes.delayMs;
    if (changes.intervalMs !== undefined) task.intervalMs = changes.intervalMs;
    if (changes.prompt !== undefined) task.prompt = changes.prompt;
    if (changes.enabled !== undefined) task.enabled = changes.enabled;
    if (changes.type !== undefined) task.type = changes.type;
    task.updatedAt = Date.now();

    if (wasEnabled !== task.enabled || scheduleChanged) {
      this.#stopJob(id);
      if (task.enabled && !this.#stopped) {
        const now = Date.now();
        task.nextFireAt = task.type === "delay" ? now + task.delayMs
          : task.type === "interval" ? now + task.intervalMs
          : Bun.cron.parse(task.schedule)?.getTime();
        this.#startJob(task);
      }
    }

    this.#persist();
    this.#logger.info("schedule task updated", { id, changes: Object.keys(changes) });
    return task;
  }

  cancel(id: string): boolean {
    const task = this.#tasks.get(id);
    if (!task) return false;
    this.#stopJob(id);
    this.#tasks.delete(id);
    this.#persist();
    this.#logger.info("schedule task cancelled", { id, name: task.name });
    return true;
  }

  restore(): void {
    try {
      if (!existsSync(this.#persistPath)) return;
      const raw = readFileSync(this.#persistPath, "utf-8");
      const data: ScheduledTask[] = JSON.parse(raw);
      for (const t of data) {
        this.#tasks.set(t.id, t);
        if (t.enabled) this.#startJob(t);
      }
      this.#logger.info("schedule tasks restored", { count: data.length });
    } catch (err) {
      this.#logger.warn("failed to restore schedule tasks", { error: String(err) });
    }
  }

  stop(): void {
    this.#stopped = true;
    for (const id of this.#jobs.keys()) this.#stopJob(id);
    for (const id of this.#timers.keys()) this.#clearTimer(id);
    this.#persist();
  }

  #startJob(task: ScheduledTask): void {
    if (task.type === "delay") {
      this.#startDelay(task);
    } else if (task.type === "interval") {
      this.#startInterval(task);
    } else {
      this.#startCron(task);
    }
  }

  #startCron(task: ScheduledTask): void {
    try {
      const job = Bun.cron(task.schedule, () => this.#fire(task));
      this.#jobs.set(task.id, job);
    } catch (err) {
      this.#logger.error("failed to start cron job", { id: task.id, name: task.name, error: String(err) });
      task.enabled = false;
    }
  }

  #startDelay(task: ScheduledTask): void {
    const timer = setTimeout(() => {
      this.#fire(task);
      task.enabled = false;
      this.#tasks.delete(task.id);
      this.#timers.delete(task.id);
      this.#persist();
    }, task.delayMs);
    this.#timers.set(task.id, timer);
  }

  #startInterval(task: ScheduledTask): void {
    const timer = setInterval(() => {
      this.#fire(task);
      task.nextFireAt = Date.now() + task.intervalMs;
    }, task.intervalMs);
    this.#timers.set(task.id, timer);
  }

  #fire(task: ScheduledTask): void {
    if (this.#stopped) return;
    task.lastFiredAt = Date.now();
    if (task.type === "cron") {
      task.nextFireAt = Bun.cron.parse(task.schedule)?.getTime();
    }
    this.#persist();
    this.#logger.info("schedule task fired", { id: task.id, name: task.name, type: task.type });

    if (task.onFire) {
      task.onFire(task);
      return;
    }

    const taskItem = createTaskItem({
      sessionId: task.sessionId,
      chatId: task.chatId,
      pipeline: "conversation",
      source: TaskSource.INTERNAL,
      payload: [{ type: "text", data: task.prompt }],
    });
    this.#queue.enqueue(taskItem);
    this.#logger.info("schedule task enqueued", { id: task.id, taskItemId: taskItem.id });
  }

  #stopJob(id: string): void {
    const job = this.#jobs.get(id);
    if (job) {
      job.stop();
      this.#jobs.delete(id);
    }
    this.#clearTimer(id);
  }

  #clearTimer(id: string): void {
    const timer = this.#timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.#timers.delete(id);
    }
  }

  #persist(): void {
    try {
      const tasks = [...this.#tasks.values()];
      writeFileSync(this.#persistPath, JSON.stringify(tasks, null, 2), "utf-8");
    } catch (err) {
      this.#logger.warn("failed to persist schedule tasks", { error: String(err) });
    }
  }
}
