/** Model context limits — max input tokens per provider+model */
export const CONTEXT_LIMITS: Record<string, number> = {
  "deepseek/deepseek-v4-pro": 1_000_000,
  "deepseek/deepseek-v4-flash": 1_000_000,
};

/** Fallback context limit when no explicit value is found */
export const DEFAULT_CONTEXT_LIMIT = 131_072;

/** Default max output tokens when not specified in config */
export const DEFAULT_MAX_TOKENS = 4096;

export function resolveContextLimit(
  providerModel: string,
  configLimit?: number,
): number {
  if (configLimit) return configLimit;
  if (CONTEXT_LIMITS[providerModel]) return CONTEXT_LIMITS[providerModel];
  return DEFAULT_CONTEXT_LIMIT;
}
