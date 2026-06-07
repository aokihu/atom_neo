import { PromptRegistry } from "./registry";
import { PromptKey } from "./keys";
import { zhBases } from "./variants/lang/zh";
import { enBases } from "./variants/lang/en";
import { deepseekV4ProRefinements } from "./variants/models/deepseek-v4-pro";
import { deepseekV4FlashRefinements } from "./variants/models/deepseek-v4-flash";
import { gpt4oRefinements } from "./variants/models/gpt-4o";
import { claudeSonnetRefinements } from "./variants/models/claude-sonnet";

export { PromptKey };
export type { PromptRegistry };

let _instance: PromptRegistry;

export function getRegistry(): PromptRegistry {
  if (!_instance) _instance = new PromptRegistry();
  return _instance;
}

export function initPromptRegistry(): void {
  const r = getRegistry();

  r.registerLangBases("zh", zhBases);
  r.registerLangBases("en", enBases);

  r.registerModelRefinements("deepseek-v4-pro", deepseekV4ProRefinements);
  r.registerModelRefinements("deepseek-v4-flash", deepseekV4FlashRefinements);
  r.registerModelRefinements("gpt-4o", gpt4oRefinements);
  r.registerModelRefinements("claude-sonnet", claudeSonnetRefinements);
}

export function resolvePrompt(key: PromptKey, providerModel?: string): string {
  const [provider = "deepseek", model = "deepseek-v4-pro"] = (providerModel ?? "deepseek/deepseek-v4-pro").split("/");
  return getRegistry().resolve(key, provider, model);
}
