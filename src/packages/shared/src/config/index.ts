export { ClientConfigSchema } from "./client";
export type { ClientConfig } from "./client";

export {
  PROVIDERS,
  DEFAULT_PROFILES,
  DEFAULT_DECISION_MODES,
  OPENROUTER_JEV,
  PROVIDER_TYPES,
  THINKING_MODES,
  ProviderProfilesSchema,
  ProviderDefinitionSchema,
} from "./providers";
export type { ProviderType, ProviderPreset, ThinkingMode, DecisionModes } from "./providers";

export { THEME_NAMES, DEFAULT_THEME, isThemeName } from "./theme";
export type { ThemeName } from "./theme";

export {
  ConfigSchema,
  RuntimeConfigSchema,
  mergeConfig,
  overlaySchema,
  runtimeConfigPath,
} from "./schema";
export type { AppConfig, RuntimeConfig, DeepPartial } from "./schema";
