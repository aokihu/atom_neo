export type ScheduledTask = {
  readonly id: string;
  readonly name: string;
  type: "cron" | "delay" | "interval";
  schedule: string;
  delayMs: number;
  intervalMs: number;
  readonly sessionId: string;
  readonly chatId: string;
  prompt: string;
  enabled: boolean;
  readonly createdAt: number;
  updatedAt: number;
  lastFiredAt?: number;
  nextFireAt?: number;
  onFire?: (task: ScheduledTask) => void;
};
