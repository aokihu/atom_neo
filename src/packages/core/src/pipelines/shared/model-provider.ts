/**
 * Purpose: Single entry point for constructing provider SDK models and
 * provider-specific request options.
 * Ownership: Core pipelines and root services; no network I/O happens here.
 * Invariants: openai-compatible requires an explicit baseUrl; DeepSeek keeps
 * its existing thinking option shape.
 */
import type { LanguageModel, JSONValue } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { inferProviderProtocol } from "@atom-neo/shared";
import type { ProviderProtocol, ResolvedModel } from "@atom-neo/shared";

export type ModelConfig = {
  provider?: string;
  protocol?: ProviderProtocol;
  model: string;
  apiKey: string;
  baseUrl?: string;
};

export type ProviderOptionsMap = Record<string, Record<string, JSONValue>>;

type ProviderOptionsConfig = {
  protocol: ProviderProtocol;
  thinking?: string;
  options?: Record<string, unknown>;
};

/** Construct an AI SDK language model for the configured provider protocol. */
export function createLanguageModel(config: ResolvedModel | ModelConfig): LanguageModel {
  const providerId = config.provider ?? "deepseek";
  const protocol = config.protocol ?? inferProviderProtocol(providerId);
  const apiKey = config.apiKey;

  switch (protocol) {
    case "deepseek":
      return createDeepSeek({ apiKey, baseURL: config.baseUrl })(config.model);
    case "openai":
      return createOpenAI({ apiKey, baseURL: config.baseUrl })(config.model);
    case "anthropic":
      return createAnthropic({ apiKey, baseURL: config.baseUrl })(config.model);
    case "openai-compatible": {
      if (!config.baseUrl?.trim()) {
        throw new Error(`openai-compatible provider "${providerId}" requires a baseUrl`);
      }
      return createOpenAICompatible({
        name: providerId,
        apiKey,
        baseURL: config.baseUrl,
      })(config.model);
    }
  }
}

/**
 * Build AI SDK providerOptions for the configured protocol. Caller-provided
 * `options` are treated as a raw, already-shaped providerOptions object.
 */
export function providerOptionsFor(config: ProviderOptionsConfig): ProviderOptionsMap {
  if (config.options) return config.options as ProviderOptionsMap;

  switch (config.protocol) {
    case "deepseek": {
      const type = config.thinking === "adaptive" ? "enabled" : config.thinking ?? "disabled";
      return { deepseek: { thinking: { type } } };
    }
    case "anthropic":
      return config.thinking === "enabled" || config.thinking === "adaptive"
        ? { anthropic: { thinking: { type: "enabled", budgetTokens: 2048 } } }
        : {};
    case "openai":
    case "openai-compatible":
      return {};
  }
}

/** Backwards-compatible DeepSeek-only wrapper. */
export function deepSeekProviderOptions(thinking?: string): ProviderOptionsMap {
  return providerOptionsFor({ protocol: "deepseek", thinking });
}
