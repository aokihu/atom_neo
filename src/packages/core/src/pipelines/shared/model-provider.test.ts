import { describe, expect, test } from "bun:test";
import { createLanguageModel, providerOptionsFor } from "./model-provider";

describe("createLanguageModel", () => {
  test("deepseek selects the DeepSeek SDK model", () => {
    const model = createLanguageModel({
      provider: "deepseek", protocol: "deepseek", apiKey: "key", model: "deepseek-v4-flash",
    });
    expect(model).toMatchObject({ provider: "deepseek.chat", modelId: "deepseek-v4-flash" });
  });

  test("openai selects the OpenAI SDK model", () => {
    const model = createLanguageModel({
      provider: "openai", protocol: "openai", apiKey: "key", model: "gpt-4o",
    });
    expect(model).toMatchObject({ provider: "openai.responses", modelId: "gpt-4o" });
  });

  test("anthropic selects the Anthropic SDK model", () => {
    const model = createLanguageModel({
      provider: "anthropic", protocol: "anthropic", apiKey: "key", model: "claude-sonnet",
    });
    expect(model).toMatchObject({ provider: "anthropic.messages", modelId: "claude-sonnet" });
  });

  test("openai-compatible selects the compatible SDK with the provider name", () => {
    const model = createLanguageModel({
      provider: "volengine", protocol: "openai-compatible", apiKey: "key", model: "v1", baseUrl: "https://example.test/v1",
    });
    expect(model).toMatchObject({ provider: "volengine.chat", modelId: "v1" });
  });

  test("openai-compatible requires a baseUrl", () => {
    expect(() => createLanguageModel({
      provider: "volengine", protocol: "openai-compatible", apiKey: "key", model: "v1",
    })).toThrow('openai-compatible provider "volengine" requires a baseUrl');
  });

  test("infers the protocol from the provider id when omitted", () => {
    const model = createLanguageModel({ provider: "openai", apiKey: "key", model: "gpt-4o" });
    expect(model).toMatchObject({ provider: "openai.responses" });
  });
});

describe("providerOptionsFor", () => {
  test("preserves DeepSeek thinking behavior", () => {
    expect(providerOptionsFor({ protocol: "deepseek", thinking: "enabled" }))
      .toEqual({ deepseek: { thinking: { type: "enabled" } } });
    expect(providerOptionsFor({ protocol: "deepseek", thinking: "adaptive" }))
      .toEqual({ deepseek: { thinking: { type: "enabled" } } });
    expect(providerOptionsFor({ protocol: "deepseek" }))
      .toEqual({ deepseek: { thinking: { type: "disabled" } } });
  });

  test("maps Anthropic thinking to a token budget", () => {
    expect(providerOptionsFor({ protocol: "anthropic", thinking: "enabled" }))
      .toEqual({ anthropic: { thinking: { type: "enabled", budgetTokens: 2048 } } });
    expect(providerOptionsFor({ protocol: "anthropic", thinking: "adaptive" }))
      .toEqual({ anthropic: { thinking: { type: "enabled", budgetTokens: 2048 } } });
    expect(providerOptionsFor({ protocol: "anthropic", thinking: "disabled" })).toEqual({});
  });

  test("OpenAI and compatible providers send nothing by default", () => {
    expect(providerOptionsFor({ protocol: "openai", thinking: "enabled" })).toEqual({});
    expect(providerOptionsFor({ protocol: "openai-compatible" })).toEqual({});
  });

  test("caller-provided options are used as raw providerOptions", () => {
    const options = { openai: { reasoningEffort: "low" } };
    expect(providerOptionsFor({ protocol: "openai", options })).toBe(options);
    expect(providerOptionsFor({ protocol: "deepseek", thinking: "enabled", options })).toBe(options);
  });
});
