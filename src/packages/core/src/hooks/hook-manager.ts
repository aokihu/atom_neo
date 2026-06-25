import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { TaskSource, BusEvents } from "@atom-neo/shared";
import type { Hook, HookTrigger, FullEventMap, Logger, PipelineEventBus } from "@atom-neo/shared";
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
  #persistPath: string;
  #logger: Logger;
  #hooks = new Map<string, Hook>();
  #lastActiveSessionId: string | null = null;

  constructor(
    scheduleService: ScheduleService,
    bus: PipelineEventBus<FullEventMap>,
    queue: TaskQueue,
    persistPath: string,
    logger: Logger,
  ) {
    this.#scheduleService = scheduleService;
    this.#bus = bus;
    this.#queue = queue;
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
      if (hook.trigger.type.startsWith("time:")) {
        this.#cancelScheduleTask(hook.id);
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
    try {
      if (!existsSync(this.#persistPath)) return;
      const raw = readFileSync(this.#persistPath, "utf-8");
      const data: Hook[] = JSON.parse(raw);
      for (const h of data) {
        if (h.scope === "session") continue;
        this.#hooks.set(h.id, h);
        if (h.enabled && h.trigger.type.startsWith("time:")) {
          this.#scheduleTimeTrigger(h);
        }
      }
      this.#logger.info("hooks restored", { count: data.length });
    } catch (err) {
      this.#logger.warn("failed to restore hooks", { error: String(err) });
    }
  }

  stop(): void {
    for (const h of this.#hooks.values()) {
      if (h.trigger.type.startsWith("time:")) {
        this.#cancelScheduleTask(h.id);
      }
    }
    this.#persist();
  }

  #scheduleIdMap = new Map<string, string>();

  #scheduleTimeTrigger(hook: Hook): void {
    const trigger = hook.trigger as Extract<HookTrigger, { type: "time:cron" } | { type: "time:delay" } | { type: "time:interval" }>;
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
      onFire: () => this.#fire(hook),
    });
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
    const sessionId = hook.scope === "session" ? hook.sessionId : this.#lastActiveSessionId;
    if (!sessionId) {
      this.#logger.warn("hook skipped: no active session", { id: hook.id, name: hook.name, scope: hook.scope });
      return;
    }
    const taskItem = createTaskItem({
      sessionId,
      chatId: "default",
      pipeline: "conversation",
      source: TaskSource.EXTERNAL,
      payload: [{ type: "text", data: hook.prompt }],
    });
    this.#queue.enqueue(taskItem);
    this.#bus.emit(BusEvents.Task.Enqueued as any, { task: taskItem });
    hook.lastFiredAt = Date.now();
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

    this.#bus.on(BusEvents.Task.Completed as any, (_ev: unknown) => {
      this.#matchAndFire("task:completed");
    });
  }

  #matchAndFire(triggerType: string): void {
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
