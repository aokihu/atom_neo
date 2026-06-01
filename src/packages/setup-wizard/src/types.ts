export interface WizardState {
  step: number;
  provider: string;
  apiKeyEnv: string;
  apiKey: string;
  models: string[];
  customBaseUrl?: string;
  profiles: {
    advanced: string;
    balanced: string;
    basic: string;
  };
  theme: string;
  projectDescription: string;
}

export const PROVIDERS: Record<string, { apiKeyEnv: string; models: string[]; baseUrl?: string }> = {
  deepseek: {
    apiKeyEnv: "DEEPSEEK_API_KEY",
    models: ["deepseek-v4-flash", "deepseek-v4-pro"],
  },
  openai: {
    apiKeyEnv: "OPENAI_API_KEY",
    models: ["gpt-4o", "gpt-4o-mini", "o4-mini"],
  },
  custom: {
    apiKeyEnv: "",
    models: [],
  },
};

export const THEMES = [
  "github-dark",
  "github-light",
  "dracula",
  "nord",
  "tokyo-night",
  "solarized-dark",
  "monokai",
] as const;

export function initialState(): WizardState {
  return {
    step: 0,
    provider: "deepseek",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    apiKey: "",
    models: ["deepseek-v4-flash", "deepseek-v4-pro"],
    customBaseUrl: undefined,
    profiles: {
      advanced: "deepseek/deepseek-v4-flash",
      balanced: "deepseek/deepseek-v4-flash",
      basic: "deepseek/deepseek-v4-flash",
    },
    theme: "github-dark",
    projectDescription: "",
  };
}
