import { generateText } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import type { PromptKey } from "@atom-neo/shared";
import { resolvePrompt } from "@atom-neo/shared";

export async function callLLM(params: {
  apiKey: string;
  model: string;
  baseUrl?: string;
  systemKey: PromptKey;
  prompt: string;
  maxTokens: number;
}): Promise<string> {
  const provider = createDeepSeek({ apiKey: params.apiKey, baseURL: params.baseUrl });
  const model = provider(params.model);
  const result = await generateText({
    model,
    system: resolvePrompt(params.systemKey),
    prompt: params.prompt,
    maxTokens: params.maxTokens,
    temperature: 0,
  });
  return result.text.trim();
}

export function parseJsonFromLLMResponse<T>(raw: string): T | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
}
