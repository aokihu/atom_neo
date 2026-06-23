import { z } from "zod";
import type { ToolDefinition } from "@atom-neo/shared";
import { PermissionLevel } from "@atom-neo/shared";
import type { HookManager } from "../../hooks/hook-manager";

const createInput = z.object({
  name: z.string().describe("Unique name for this scheduled task"),
  type: z.enum(["cron", "delay", "interval"]).default("cron").describe("Schedule type: cron expression, one-shot delay, or repeating interval"),
  schedule: z.string().optional().describe("Cron expression for type=cron. Uses UTC timezone. e.g. '30 23 * * *' for Beijing 07:30, '@daily'"),
  delayMs: z.number().int().positive().optional().describe("Delay in milliseconds before firing once (for type=delay). e.g. 300000 for 5 minutes"),
  intervalMs: z.number().int().positive().optional().describe("Interval in milliseconds between repeated firings (for type=interval). e.g. 60000 for every minute"),
  prompt: z.string().describe("Text prompt to send when the schedule fires"),
  scope: z.enum(["session", "global"]).default("session").describe("session=binds to current session (auto-cancelled on close), global=survives sessions"),
});

const listInput = z.object({
  enabled: z.boolean().optional().describe("Filter by enabled status"),
});

const updateInput = z.object({
  id: z.string().describe("Task ID to update"),
  schedule: z.string().optional().describe("New cron expression (for type=cron)"),
  delayMs: z.number().int().positive().optional().describe("New delay in ms (for type=delay)"),
  intervalMs: z.number().int().positive().optional().describe("New interval in ms (for type=interval)"),
  prompt: z.string().optional().describe("New prompt text"),
  enabled: z.boolean().optional().describe("Enable or disable the task"),
});

const cancelInput = z.object({
  id: z.string().describe("Task ID to cancel"),
});

export function createScheduleTools(
  hookRef: { current: HookManager | null },
  sessionRef: { current: { sessionId: string; chatId: string } | null },
): ToolDefinition[] {
  function hm() {
    if (!hookRef.current) throw new Error("HookManager not initialized");
    return hookRef.current;
  }

  function resolveTrigger(type: string, data: { schedule?: string; delayMs?: number; intervalMs?: number }) {
    switch (type) {
      case "delay": return { type: "time:delay" as const, delayMs: data.delayMs! };
      case "interval": return { type: "time:interval" as const, intervalMs: data.intervalMs! };
      default: return { type: "time:cron" as const, schedule: data.schedule! };
    }
  }

  const scheduleCreate: ToolDefinition = {
    name: "schedule_create",
    description: "Create a scheduled task that triggers an AI conversation. Cron schedules use UTC timezone (Beijing = UTC+8). Supports cron expressions (type=cron), one-shot delayed execution in milliseconds (type=delay), or repeating interval in milliseconds (type=interval). scope=session binds to current session (auto-cleaned on close), scope=global survives sessions.",
    source: "builtin",
    inputSchema: createInput,
    execute: async (args) => {
      const r = createInput.safeParse(args);
      if (!r.success) return { ok: false, output: "", error: r.error.message };
      try {
        const hook = hm().create({
          name: r.data.name,
          scope: r.data.scope,
          sessionId: sessionRef.current?.sessionId,
          trigger: resolveTrigger(r.data.type, r.data),
          prompt: r.data.prompt,
        });
        return {
          ok: true,
          output: `Scheduled task created: ${hook.id} ("${hook.name}") scope=${hook.scope} trigger=${hook.trigger.type}.`,
          data: hook,
        };
      } catch (err) {
        return { ok: false, output: "", error: err instanceof Error ? err.message : String(err) };
      }
    },
    permission: PermissionLevel.FULL,
  };

  const scheduleList: ToolDefinition = {
    name: "schedule_list",
    description: "List all scheduled tasks. Optionally filter by enabled status.",
    source: "builtin",
    inputSchema: listInput,
    execute: async (args) => {
      const r = listInput.safeParse(args);
      if (!r.success) return { ok: false, output: "", error: r.error.message };
      try {
        const hooks = hm().list(r.data);
        if (hooks.length === 0) return { ok: true, output: "No scheduled tasks." };
        const lines = hooks.map(h => {
          const last = h.lastFiredAt ? new Date(h.lastFiredAt).toISOString() : "never";
          const status = h.enabled ? "enabled" : "disabled";
          const detail = h.trigger.type === "time:cron" ? `cron: ${h.trigger.schedule}`
            : h.trigger.type === "time:delay" ? `delay: ${h.trigger.delayMs}ms`
            : h.trigger.type === "time:interval" ? `interval: ${h.trigger.intervalMs}ms`
            : h.trigger.type;
          const sid = h.sessionId ? ` sid=${h.sessionId}` : "";
          return `- [${status}] ${h.id}: "${h.name}" | ${detail} | scope=${h.scope}${sid} | last: ${last}`;
        });
        return { ok: true, output: lines.join("\n"), data: hooks };
      } catch (err) {
        return { ok: false, output: "", error: err instanceof Error ? err.message : String(err) };
      }
    },
    permission: PermissionLevel.READ_ONLY,
  };

  const scheduleUpdate: ToolDefinition = {
    name: "schedule_update",
    description: "Update a scheduled task. Change its schedule/delay/interval, prompt, scope, or enable/disable it.",
    source: "builtin",
    inputSchema: updateInput,
    execute: async (args) => {
      const r = updateInput.safeParse(args);
      if (!r.success) return { ok: false, output: "", error: r.error.message };
      try {
        const hook = hm().update(r.data.id, r.data);
        return {
          ok: true,
          output: `Scheduled task updated: ${hook.id} ("${hook.name}"). Trigger: ${hook.trigger.type}. Enabled: ${hook.enabled}.`,
          data: hook,
        };
      } catch (err) {
        return { ok: false, output: "", error: err instanceof Error ? err.message : String(err) };
      }
    },
    permission: PermissionLevel.FULL,
  };

  const scheduleCancel: ToolDefinition = {
    name: "schedule_cancel",
    description: "Cancel/delete a scheduled task by its ID.",
    source: "builtin",
    inputSchema: cancelInput,
    execute: async (args) => {
      const r = cancelInput.safeParse(args);
      if (!r.success) return { ok: false, output: "", error: r.error.message };
      try {
        const ok = hm().cancel(r.data.id);
        return ok
          ? { ok: true, output: `Scheduled task "${r.data.id}" cancelled.` }
          : { ok: false, output: "", error: `Scheduled task "${r.data.id}" not found.` };
      } catch (err) {
        return { ok: false, output: "", error: err instanceof Error ? err.message : String(err) };
      }
    },
    permission: PermissionLevel.FULL,
  };

  return [scheduleCreate, scheduleList, scheduleUpdate, scheduleCancel];
}
