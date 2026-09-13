import { useEffect, useState } from "react";
import type { Hook } from "@atom-neo/shared";
import { useTheme } from "./App";
import { TelemetrySection } from "./Sidebar";
import { EmptyState } from "./EmptyState";

type ScheduleSummary = Omit<Hook, "prompt">;

export function scheduleStatus(task: ScheduleSummary): string {
  if (task.expiredAt) return "EXPIRED";
  if (task.trigger.type === "time:delay" && task.lastFiredAt && !task.enabled) return "DONE";
  return task.enabled ? "WAITING" : "DISABLED";
}

export function ScheduleBar({ url, adminToken }: { url: string; adminToken?: string }) {
  const { colors } = useTheme();
  const [tasks, setTasks] = useState<ScheduleSummary[]>([]);
  const [state, setState] = useState("LOADING");

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch(`${url.replace(/\/$/, "")}/api/schedules`, {
          headers: adminToken ? { "x-atom-admin-token": adminToken } : {},
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(4000)]),
        });
        if (!response.ok) throw new Error("Schedules unavailable");
        const data = await response.json() as ScheduleSummary[];
        if (!disposed) { setTasks(data); setState(data.length ? "" : "EMPTY"); }
      } catch {
        if (!disposed) { setTasks([]); setState("UNAVAILABLE"); }
      } finally {
        if (!disposed) timer = setTimeout(refresh, 2000);
      }
    };
    setTasks([]);
    setState("LOADING");
    void refresh();
    return () => { disposed = true; controller.abort(); clearTimeout(timer); };
  }, [url, adminToken]);

  return <TelemetrySection title="SCHEDULES" meta={state === "LOADING" || state === "UNAVAILABLE" ? "—" : String(tasks.length)}>
    <scrollbox height={3} flexShrink={0}>
      {state === "EMPTY" ? <EmptyState /> : state ? <text fg={state === "UNAVAILABLE" ? colors.status.warning : colors.text.muted}>{state}</text> : tasks.map(task => (
        <box key={task.id} flexDirection="column" marginBottom={1}>
          <text fg={colors.text.muted}>{task.name}</text>
          <text fg={task.expiredAt ? colors.status.warning : colors.text.muted}>{`${task.scope} · ${scheduleStatus(task)}`}</text>
          <text fg={colors.text.muted}>{task.enabled && task.nextFireAt ? new Date(task.nextFireAt).toLocaleString() : "—"}</text>
        </box>
      ))}
    </scrollbox>
  </TelemetrySection>;
}
