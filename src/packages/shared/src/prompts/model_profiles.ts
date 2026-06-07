export const LANGUAGE_MAP: Record<string, "zh" | "en"> = {
  deepseek: "zh",
  openai: "en",
  anthropic: "en",
};

export const MODEL_REFINEMENT_MAP: Record<string, string[]> = {
  "deepseek/deepseek-v4-pro": ["deepseek-v4-pro"],
  "deepseek/deepseek-v4-flash": ["deepseek-v4-flash"],
  "openai/gpt-4o": ["gpt-4o"],
  "anthropic/claude-sonnet": ["claude-sonnet"],
};
