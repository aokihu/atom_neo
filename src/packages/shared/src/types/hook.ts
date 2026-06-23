export type HookTrigger =
  | { type: "time:cron"; schedule: string }
  | { type: "time:delay"; delayMs: number }
  | { type: "time:interval"; intervalMs: number }
  | { type: "session:start" }
  | { type: "session:end" }
  | { type: "task:completed" };

export type Hook = {
  readonly id: string;
  readonly name: string;
  scope: "session" | "global";
  sessionId?: string;
  trigger: HookTrigger;
  prompt: string;
  enabled: boolean;
  readonly createdAt: number;
  updatedAt: number;
  lastFiredAt?: number;
};
