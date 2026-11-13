/** Pure process lifecycle state machine; no timers or I/O. */
export type ProcessState = "idle" | "starting" | "running" | "stopping" | "failed";

export type ProcessEvent =
  | { type: "start" }
  | { type: "spawned" }
  | { type: "ready" }
  | { type: "exit"; intentional: boolean }
  | { type: "stop" }
  | { type: "health_failed" }
  | { type: "reset" };

type EventKey = ProcessEvent["type"] | "exit:intentional" | "exit:unexpected";

const TRANSITIONS: Record<ProcessState, Partial<Record<EventKey, ProcessState>>> = {
  idle: {
    start: "starting",
    stop: "idle",
    reset: "idle",
  },
  starting: {
    start: "starting",
    spawned: "starting",
    ready: "running",
    stop: "stopping",
    "exit:intentional": "idle",
    "exit:unexpected": "failed",
    health_failed: "failed",
    reset: "idle",
  },
  running: {
    start: "running",
    stop: "stopping",
    "exit:intentional": "idle",
    "exit:unexpected": "failed",
    health_failed: "failed",
    reset: "idle",
  },
  stopping: {
    stop: "stopping",
    "exit:intentional": "idle",
    "exit:unexpected": "failed",
    reset: "idle",
  },
  failed: {
    start: "starting",
    stop: "idle",
    "exit:intentional": "idle",
    "exit:unexpected": "failed",
    health_failed: "failed",
    reset: "idle",
  },
};

function eventKey(event: ProcessEvent): EventKey {
  if (event.type === "exit") return event.intentional ? "exit:intentional" : "exit:unexpected";
  return event.type;
}

export function nextProcessState(state: ProcessState, event: ProcessEvent): ProcessState {
  const next = TRANSITIONS[state][eventKey(event)];
  if (!next) throw new Error(`Invalid process transition: ${state} -> ${eventKey(event)}`);
  return next;
}
