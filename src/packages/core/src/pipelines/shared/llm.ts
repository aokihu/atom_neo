import { generateText } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import type { PromptKey } from "@atom-neo/shared";
import { resolvePrompt } from "@atom-neo/shared";

export function deepSeekProviderOptions(thinking?: string) {
  return { deepseek: { thinking: { type: thinking === "adaptive" ? "enabled" : thinking ?? "disabled" } } };
}

export async function callLLM(params: {
  apiKey: string;
  model: string;
  baseUrl?: string;
  thinking?: string;
  systemKey: PromptKey;
  prompt: string;
  maxTokens: number;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const provider = createDeepSeek({ apiKey: params.apiKey, baseURL: params.baseUrl });
  const model = provider(params.model);
  const result = await generateText({
    model,
    instructions: resolvePrompt(params.systemKey),
    prompt: params.prompt,
    maxOutputTokens: params.maxTokens,
    temperature: 0,
    providerOptions: deepSeekProviderOptions(params.thinking),
    abortSignal: params.abortSignal,
  });
  return result.text.trim();
}

export function parseJsonFromLLMResponse<T>(raw: string): T | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
}
