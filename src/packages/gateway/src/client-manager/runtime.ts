/** Production runtime defaults for ClientManager; tests inject fakes here. */
import { sleep, spawnProcess } from "@atom-neo/shared";
import type { ProcessHandle, SpawnProcessOptions } from "@atom-neo/shared";

export type TimerHandle = ReturnType<typeof setTimeout>;
export type IntervalHandle = ReturnType<typeof setInterval>;
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type ClientManagerRuntime = {
  spawn: (command: readonly string[], options?: SpawnProcessOptions) => ProcessHandle;
  fetch: FetchLike;
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => TimerHandle;
  clearTimeout: (handle: TimerHandle) => void;
  setInterval: (fn: () => void, ms: number) => IntervalHandle;
  clearInterval: (handle: IntervalHandle) => void;
  sleep: (ms: number) => Promise<void>;
};

export const productionRuntime: ClientManagerRuntime = {
  spawn: spawnProcess,
  fetch: (input, init) => fetch(input, init),
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle),
  sleep,
};
