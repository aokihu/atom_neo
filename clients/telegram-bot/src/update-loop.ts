/** Pure Telegram update offset/retry bookkeeping. */
import { GatewayBusyError } from "./gateway-client";

export type UpdateLike = { update_id: number };

export type UpdateLoopState = {
  offset: number;
  retries: Map<string, number>;
};

export type UpdateBatchResult = { retryAfterMs?: number };

const retryKey = (updateId: number): string => `u${updateId}`;

/**
 * Processes one poll batch in order.
 * - Busy gateway stops the batch without advancing the offset or retry count.
 * - Other failures retry the same update until maxAttempts, then advance past it.
 */
export async function processUpdateBatch<T extends UpdateLike>(
  updates: readonly T[],
  state: UpdateLoopState,
  handle: (update: T) => Promise<void>,
  maxAttempts = 3,
): Promise<UpdateBatchResult> {
  for (const update of updates) {
    const key = retryKey(update.update_id);
    const attempts = (state.retries.get(key) ?? 0) + 1;

    try {
      await handle(update);
      state.offset = update.update_id + 1;
      state.retries.delete(key);
    } catch (err) {
      if (err instanceof GatewayBusyError) return { retryAfterMs: err.retryAfterMs };

      if (attempts >= maxAttempts) {
        state.offset = update.update_id + 1;
        state.retries.delete(key);
        continue;
      }

      state.retries.set(key, attempts);
      return {};
    }
  }

  return {};
}
