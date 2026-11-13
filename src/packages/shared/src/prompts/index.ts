import type { PromptKey } from "./keys";
import { PromptRegistry } from "./registry";
import { zhBases } from "./variants/lang/zh";
import { enBases } from "./variants/lang/en";
import { deepseekV4ProRefinements } from "./variants/models/deepseek-v4-pro";
import { deepseekV4FlashRefinements } from "./variants/models/deepseek-v4-flash";
import { gpt4oRefinements } from "./variants/models/gpt-4o";
import { claudeSonnetRefinements } from "./variants/models/claude-sonnet";

export { PromptKey } from "./keys";
export { PromptRegistry } from "./registry";

export type PromptResolver = (key: PromptKey, providerModel?: string) => string;

const DEFAULT_PROVIDER_MODEL = "openai/gpt-4o";

/** Build an independent registry with every language/model variant registered. */
export function createPromptRegistry(): PromptRegistry {
  const registry = new PromptRegistry();

  registry.registerLangBases("zh", zhBases);
  registry.registerLangBases("en", enBases);

  registry.registerModelRefinements("deepseek-v4-pro", deepseekV4ProRefinements);
  registry.registerModelRefinements("deepseek-v4-flash", deepseekV4FlashRefinements);
  registry.registerModelRefinements("gpt-4o", gpt4oRefinements);
  registry.registerModelRefinements("claude-sonnet", claudeSonnetRefinements);

  return registry;
}

/** Bind a narrow resolver to one registry; defaults to the OpenAI GPT-4o profile. */
export function createPromptResolver(registry: PromptRegistry): PromptResolver {
  return (key, providerModel) => {
    const [provider = "openai", model = "gpt-4o"] = (providerModel ?? DEFAULT_PROVIDER_MODEL).split("/");
    return registry.resolve(key, provider, model);
  };
}
