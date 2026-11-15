export { ClientConfigSchema, clientConfigMigrationHint, clientSource } from "./client";
export type { ClientConfig, ClientSource } from "./client";
export {
  credentialRef,
  listInstances,
  readConfigRevision,
  removeInstance,
  upsertInstance,
} from "./client-instance";
export type { InstanceFileWriter, InstanceWriteOptions, InstanceWriteResult } from "./client-instance";

export {
  PROVIDERS,
  DEFAULT_PROFILES,
  DEFAULT_DECISION_MODES,
  OPENROUTER_JEV,
  PROVIDER_TYPES,
  PROVIDER_PROTOCOLS,
  THINKING_MODES,
  ProviderProfilesSchema,
  ProviderDefinitionSchema,
  inferProviderProtocol,
} from "./providers";
export type {
  ProviderType,
  ProviderProtocol,
  ProviderPreset,
  ThinkingMode,
  ProfileLevel,
  ResolvedModel,
  DecisionModes,
} from "./providers";

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
