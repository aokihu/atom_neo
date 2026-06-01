/** @jsxImportSource react */
import React, { useState } from "react";
import type { WizardState } from "../types";
import { initialState, PROVIDERS, THEMES } from "../types";
import { StepProvider } from "./StepProvider";
import { StepApiKey } from "./StepApiKey";
import { StepModel } from "./StepModel";
import { StepTheme } from "./StepTheme";
import { StepProject } from "./StepProject";
import { StepConfirm } from "./StepConfirm";

export function SetupWizard({ sandboxPath, onComplete, onAbort }: {
  sandboxPath: string;
  onComplete: () => void;
  onAbort: () => void;
}) {
  const [state, setState] = useState<WizardState>(initialState);

  const next = (patch: Partial<WizardState>) =>
    setState(prev => ({ ...prev, ...patch, step: prev.step + 1 }));

  const prev = () => setState(s => ({ ...s, step: Math.max(0, s.step - 1) }));

  const onProviderSelect = (provider: string) => {
    const info = PROVIDERS[provider];
    const models = info.models;
    const apiKeyEnv = info.apiKeyEnv;
    const firstModel = models[0] ?? "";
    next({
      provider,
      models,
      apiKeyEnv,
      apiKey: "",
      customBaseUrl: undefined,
      profiles: {
        advanced: `${provider}/${firstModel}`,
        balanced: `${provider}/${firstModel}`,
        basic: `${provider}/${firstModel}`,
      },
    });
  };

  switch (state.step) {
    case 0:
      return <StepProvider value={state.provider} onSubmit={onProviderSelect} />;
    case 1:
      return <StepApiKey
        activeProvider={state.provider}
        apiKey={state.apiKey}
        customBaseUrl={state.customBaseUrl}
        onSubmit={(apiKey, baseUrl, env) => {
          next({ apiKey, apiKeyEnv: env ?? state.apiKeyEnv, customBaseUrl: baseUrl ?? state.customBaseUrl });
        }}
        onBack={prev}
      />;
    case 2:
      return <StepModel
        provider={state.provider}
        models={state.models}
        profiles={state.profiles}
        onSubmit={(profiles) => next({ profiles })}
      />;
    case 3:
      return <StepTheme
        value={state.theme}
        themes={[...THEMES]}
        onSubmit={(theme) => next({ theme })}
      />;
    case 4:
      return <StepProject
        value={state.projectDescription}
        onSubmit={(desc) => next({ projectDescription: desc })}
      />;
    case 5:
      return <StepConfirm
        state={state}
        sandboxPath={sandboxPath}
        onConfirm={onComplete}
        onBack={prev}
      />;
    default:
      return null;
  }
}
