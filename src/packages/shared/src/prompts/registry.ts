import type { PromptKey } from "./keys";
import { LANGUAGE_MAP, MODEL_REFINEMENT_MAP } from "./model_profiles";

type CacheKey = `${PromptKey}:${string}:${string}`;
type PromptsRecord = Partial<Record<PromptKey, string>>;

export class PromptRegistry {
  #cache = new Map<CacheKey, string>();
  #langBases: Record<string, PromptsRecord> = {};
  #modelRefinements: Record<string, PromptsRecord> = {};

  registerLangBases(lang: "zh" | "en", records: PromptsRecord): void {
    const target = (this.#langBases[lang] ??= {});
    for (const [k, v] of Object.entries(records)) {
      if (v) target[k as PromptKey] = v;
    }
    this.#cache.clear();
  }

  registerModelRefinements(modelId: string, records: PromptsRecord): void {
    const target = (this.#modelRefinements[modelId] ??= {});
    for (const [k, v] of Object.entries(records)) {
      if (v) target[k as PromptKey] = v;
    }
    this.#cache.clear();
  }

  resolve(key: PromptKey, provider: string, model: string): string {
    const ck: CacheKey = `${key}:${provider}:${model}`;
    const cached = this.#cache.get(ck);
    if (cached !== undefined) return cached;

    const lang = LANGUAGE_MAP[provider] ?? "en";
    const base = this.#langBases[lang]?.[key] ?? this.#langBases["en"]?.[key] ?? "";

    const refinementIds = MODEL_REFINEMENT_MAP[`${provider}/${model}`] ?? [];
    const appends: string[] = [];
    for (const rid of refinementIds) {
      const append = this.#modelRefinements[rid]?.[key];
      if (append) appends.push(append);
    }

    const result = [base, ...appends].filter(Boolean).join("\n\n");
    this.#cache.set(ck, result);
    return result;
  }
}
