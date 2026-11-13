import { generateText } from "ai";
import type { PromptKey, PromptResolver, ProviderProtocol } from "@atom-neo/shared";
import { inferProviderProtocol } from "@atom-neo/shared";
import { createLanguageModel, providerOptionsFor } from "./model-provider";

export { deepSeekProviderOptions } from "./model-provider";

export async function callLLM(params: {
  promptResolver: PromptResolver;
  apiKey: string;
  model: string;
  provider?: string;
  protocol?: ProviderProtocol;
  baseUrl?: string;
  thinking?: string;
  options?: Record<string, unknown>;
  systemKey: PromptKey;
  prompt: string;
  maxTokens: number;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const provider = params.provider ?? "deepseek";
  const protocol = params.protocol ?? inferProviderProtocol(provider);
  const model = createLanguageModel({
    provider,
    protocol,
    apiKey: params.apiKey,
    model: params.model,
    baseUrl: params.baseUrl,
  });
  const result = await generateText({
    model,
    instructions: params.promptResolver(params.systemKey, `${provider}/${params.model}`),
    prompt: params.prompt,
    maxOutputTokens: params.maxTokens,
    temperature: 0,
    providerOptions: providerOptionsFor({ protocol, thinking: params.thinking, options: params.options }),
    abortSignal: params.abortSignal,
  });
  return result.text.trim();
}

export function parseJsonFromLLMResponse<T>(raw: string): T | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
}
