import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { TaskSource, BusEvents } from "@atom-neo/shared";
import type { Hook, HookTrigger, FullEventMap, Logger, PipelineEventBus, TaskItem } from "@atom-neo/shared";
import type { TaskQueue } from "../task-queue";
import { createTaskItem } from "../task-factory";
import type { ScheduleService } from "../tools/schedule-service";

let nextHookId = 0;

function generateId(): string {
  return `hook-${Date.now()}-${nextHookId++}`;
}

export class HookManager {
  #scheduleService: ScheduleService;
  #bus: PipelineEventBus<FullEventMap>;
  #queue: TaskQueue;
  #releaseTask?: (task: TaskItem) => boolean;
  #persistPath: string;
  #logger: Logger;
  #hooks = new Map<string, Hook>();
  #lastActiveSessionId: string | null = null;
  #stopped = false;

  constructor(
    scheduleService: ScheduleService,
    bus: PipelineEventBus<FullEventMap>,
    queue: TaskQueue,
    persistPath: string,
    logger: Logger,
    releaseTask?: (task: TaskItem) => boolean,
  ) {
    this.#scheduleService = scheduleService;
    this.#bus = bus;
    this.#queue = queue;
    this.#releaseTask = releaseTask;
    this.#persistPath = persistPath;
    this.#logger = logger;
    this.#subscribe();
  }

  create(def: {
    name: string;
    scope?: Hook["scope"];
    sessionId?: string;
    trigger: HookTrigger;
    prompt: string;
    enabled?: boolean;
  }): Hook {
    if (this.#stopped) throw new Error("Core scheduler is stopped");
    const now = Date.now();
    const hook: Hook = {
      id: generateId(),
      name: def.name,
      scope: def.scope ?? "session",
      sessionId: def.sessionId,
      trigger: def.trigger,
      prompt: def.prompt,
      enabled: def.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    };
    this.#hooks.set(hook.id, hook);

    if (hook.enabled && hook.trigger.type.startsWith("time:")) {
      this.#scheduleTimeTrigger(hook);
    }

    this.#persist();
    this.#logger.info("hook created", { id: hook.id, name: hook.name, scope: hook.scope, trigger: hook.trigger.type });
    return hook;
  }

  list(filter?: { enabled?: boolean; scope?: Hook["scope"]; sessionId?: string }): Hook[] {
    let result = [...this.#hooks.values()];
    if (filter?.enabled !== undefined) result = result.filter(h => h.enabled === filter.enabled);
    if (filter?.scope !== undefined) result = result.filter(h => h.scope === filter.scope);
    if (filter?.sessionId !== undefined) result = result.filter(h => h.sessionId === filter.sessionId);
    return result;
  }

  get(id: string): Hook | undefined {
    return this.#hooks.get(id);
  }

  update(id: string, changes: Partial<Pick<Hook, "trigger" | "prompt" | "enabled" | "scope">>): Hook {
    if (this.#stopped) throw new Error("Core scheduler is stopped");
    const hook = this.#hooks.get(id);
    if (!hook) throw new Error(`Hook "${id}" not found`);

    const wasEnabled = hook.enabled;
    const triggerChanged = changes.trigger !== undefined;

    if (changes.trigger !== undefined) hook.trigger = changes.trigger;
    if (changes.prompt !== undefined) hook.prompt = changes.prompt;
    if (changes.enabled !== undefined) hook.enabled = changes.enabled;
    if (changes.scope !== undefined) hook.scope = changes.scope;
    hook.updatedAt = Date.now();

    if (wasEnabled !== hook.enabled || triggerChanged) {
      this.#cancelScheduleTask(hook.id);
      hook.nextFireAt = undefined;
      hook.expiredAt = undefined;
      if (triggerChanged || hook.enabled) hook.lastFiredAt = undefined;
      if (hook.trigger.type.startsWith("time:")) {
        if (hook.enabled) this.#scheduleTimeTrigger(hook);
      }
    }

    this.#persist();
    this.#logger.info("hook updated", { id, changes: Object.keys(changes) });
    return hook;
  }

  cancel(id: string): boolean {
    const hook = this.#hooks.get(id);
    if (!hook) return false;
    if (hook.trigger.type.startsWith("time:")) {
      this.#cancelScheduleTask(hook.id);
    }
    this.#hooks.delete(id);
    this.#persist();
    this.#logger.info("hook cancelled", { id, name: hook.name });
    return true;
  }

  restore(): void {
    if (this.#stopped) return;
    try {
      if (!existsSync(this.#persistPath)) return;
      const raw = readFileSync(this.#persistPath, "utf-8");
      const data: Hook[] = JSON.parse(raw);
      for (const h of data) {
        if (h.scope === "session") continue;
        if (this.#hooks.has(h.id)) continue;
        this.#hooks.set(h.id, h);
        if (h.enabled && h.trigger.type.startsWith("time:")) {
          this.#scheduleTimeTrigger(h);
        }
      }
      this.#persist();
      this.#logger.info("hooks restored", { count: data.length });
    } catch (err) {
      this.#logger.warn("failed to restore hooks", { error: String(err) });
    }
  }

  stop(): void {
    this.#stopped = true;
    for (const h of this.#hooks.values()) {
      if (h.trigger.type.startsWith("time:")) {
        this.#cancelScheduleTask(h.id);
      }
    }
    this.#persist();
  }

  #scheduleIdMap = new Map<string, string>();

  #scheduleTimeTrigger(hook: Hook): void {
    if (this.#stopped) return;
    const trigger = hook.trigger as Extract<HookTrigger, { type: "time:cron" } | { type: "time:delay" } | { type: "time:interval" }>;
    if (trigger.type === "time:delay" && hook.lastFiredAt) {
      hook.enabled = false;
      hook.nextFireAt = undefined;
      return;
    }
    if (!hook.sessionId && hook.scope === "global") hook.sessionId = `schedule-${hook.id}`;
    const nextFireAt = hook.nextFireAt ?? (trigger.type === "time:delay"
      ? hook.updatedAt + trigger.delayMs
      : trigger.type === "time:interval" ? (hook.lastFiredAt ?? hook.updatedAt) + trigger.intervalMs : undefined);
    const scheduleTask = this.#scheduleService.create({
      name: hook.name,
      type: trigger.type === "time:cron" ? "cron" : trigger.type === "time:delay" ? "delay" : "interval",
      schedule: (trigger as any).schedule ?? "",
      delayMs: (trigger as any).delayMs ?? 0,
      intervalMs: (trigger as any).intervalMs ?? 0,
      sessionId: hook.sessionId ?? this.#lastActiveSessionId ?? "",
      chatId: "default",
      prompt: hook.prompt,
      enabled: true,
      nextFireAt,
      onFire: task => {
        if (this.#stopped || !hook.enabled || !this.#hooks.has(hook.id)) return;
        hook.nextFireAt = trigger.type === "time:delay" ? undefined : task.nextFireAt;
        this.#fire(hook);
        if (trigger.type === "time:delay") hook.enabled = false;
        this.#persist();
      },
    });
    hook.nextFireAt = scheduleTask.nextFireAt;
    hook.enabled = scheduleTask.enabled;
    if (!hook.enabled && trigger.type === "time:delay") hook.expiredAt = Date.now();
    this.#scheduleIdMap.set(hook.id, scheduleTask.id);
  }

  #cancelScheduleTask(hookId: string): void {
    const scheduleId = this.#scheduleIdMap.get(hookId);
    if (scheduleId) {
      this.#scheduleService.cancel(scheduleId);
      this.#scheduleIdMap.delete(hookId);
    }
  }

  #fire(hook: Hook): void {
    if (this.#stopped || !hook.enabled || !this.#hooks.has(hook.id)) return;
    const sessionId = hook.scope === "session" || hook.trigger.type.startsWith("time:") ? hook.sessionId : this.#lastActiveSessionId;
    if (!sessionId) {
      this.#logger.warn("hook skipped: no active session", { id: hook.id, name: hook.name, scope: hook.scope });
      return;
    }
    const taskItem = createTaskItem({
      sessionId,
      chatId: "default",
      pipeline: "conversation",
      source: TaskSource.INTERNAL,
      payload: [{ type: "text", data: hook.prompt }],
      origin: { type: "hook", hookId: hook.id },
    });
    if (this.#releaseTask) this.#releaseTask(taskItem);
    else {
      this.#queue.enqueue(taskItem);
      this.#bus.emit(BusEvents.Task.Enqueued as any, { task: taskItem });
    }
    hook.lastFiredAt = Date.now();
    this.#persist();
    this.#logger.info("hook fired", { id: hook.id, name: hook.name, trigger: hook.trigger.type, sessionId, taskItemId: taskItem.id });
  }

  #subscribe(): void {
    this.#bus.on(BusEvents.Task.Activated as any, (ev: { task: { sessionId: string } }) => {
      const sid = ev.task?.sessionId;
      if (sid) this.#lastActiveSessionId = sid;
    });

    this.#bus.on(BusEvents.Session.Started as any, (ev: { sessionId: string }) => {
      this.#lastActiveSessionId = ev.sessionId;
      this.#matchAndFire("session:start");
    });

    this.#bus.on(BusEvents.Session.Closed as any, (ev: { sessionId: string }) => {
      const sid = ev.sessionId;
      if (this.#lastActiveSessionId === sid) {
        this.#lastActiveSessionId = null;
      }
      for (const h of this.#hooks.values()) {
        if (h.scope === "session" && h.sessionId === sid) {
          this.cancel(h.id);
        }
      }
      this.#matchAndFire("session:end");
    });

    this.#bus.on(BusEvents.Task.Committed as any, (ev: { task: { origin?: { type: string } } }) => {
      if (ev.task.origin?.type === "hook") return;
      this.#matchAndFire("task:completed");
    });
  }

  #matchAndFire(triggerType: string): void {
    if (this.#stopped) return;
    for (const hook of this.#hooks.values()) {
      if (hook.enabled && hook.trigger.type === triggerType) {
        this.#fire(hook);
      }
    }
  }

  #persist(): void {
    try {
      const hooks: Record<string, unknown>[] = [];
      for (const h of this.#hooks.values()) {
        const { onFire, ...rest } = h as any;
        hooks.push(rest);
      }
      writeFileSync(this.#persistPath, JSON.stringify(hooks, null, 2), "utf-8");
    } catch (err) {
      this.#logger.warn("failed to persist hooks", { error: String(err) });
    }
  }
}
