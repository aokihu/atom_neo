import type { Dispatch } from "react";
import { ProvidersModal } from "../components/ProvidersModal";
import { ApiKeyModal } from "../components/ApiKeyModal";
import { ModelsModal } from "../components/ModelsModal";
import type { ModelEdit } from "../components/ModelsModal";
import { ProfilesModal } from "../components/ProfilesModal";
import { DecisionsModal } from "../components/DecisionsModal";
import { ThemeModal } from "../components/ThemeModal";
import { GatewayModal } from "../components/GatewayModal";
import type { GatewayInstanceActions } from "../gateway-status";
import { ProjectModal } from "../components/ProjectModal";
import { ConfirmModal } from "../components/ConfirmModal";
import type { WizardChrome } from "../components/WizardApp";
import { collectModelIds } from "../wizard-logic";
import type { WizardAction, WizardView } from "./wizard-reducer";
import type { PendingEdit } from "./wizard-edit";
import type { WizardState } from "./wizard-state";

type CommonProps = {
  view: WizardView | null;
  wizard: WizardState;
  pending: PendingEdit | null;
  allowJev: boolean;
  dispatch: Dispatch<WizardAction>;
  chrome?: WizardChrome;
};

export function WizardProviderViews({ view, wizard, pending, allowJev, dispatch, chrome, onModelsSubmit }: CommonProps & {
  onModelsSubmit: (patch: ModelEdit) => boolean;
}) {
  const provider = pending?.id ?? wizard.provider;

  return (
    <>
      {view?.kind === "providers" && (
        <ProvidersModal
          state={wizard}
          allowJev={allowJev}
          chrome={chrome}
          onSelect={id => dispatch({ type: "providers-select", id })}
          onAdd={id => dispatch({ type: "providers-add", id })}
          onBack={() => dispatch({ type: "providers-back" })}
        />
      )}

      {view?.kind === "apikey" && (
        <ApiKeyModal
          provider={provider}
          apiKey={wizard.apiKey}
          apiKeyEnv={wizard.apiKeyEnv}
          baseUrl={wizard.customBaseUrl}
          showEnv={!wizard.apiKeyEnv || (wizard.mode === "first-run" && !allowJev && pending?.isNew === true)}
          showBaseUrl={wizard.mode === "first-run" && wizard.provider === "custom"}
          onSubmit={(apiKey, baseUrl, env) => dispatch({ type: "apikey-submit", apiKey, baseUrl, env })}
          onCancel={() => dispatch({ type: "cancel-edit" })}
        />
      )}

      {view?.kind === "models" && (
        <ModelsModal
          provider={provider}
          models={wizard.models}
          baseUrl={wizard.customBaseUrl}
          thinking={wizard.thinking}
          contextLimit={wizard.contextLimit}
          type={pending?.edit.type}
          allowJev={allowJev}
          onSubmit={onModelsSubmit}
          onCancel={() => dispatch({ type: "models-cancel" })}
        />
      )}

      {view?.kind === "profiles" && (
        <ProfilesModal
          profiles={wizard.profiles}
          modelIds={collectModelIds(wizard.editedProviders, "llm")}
          onSubmit={profiles => dispatch({ type: "profiles-submit", profiles })}
          onBack={() => dispatch({ type: "profiles-back" })}
        />
      )}
    </>
  );
}

export function WizardSettingsViews({ view, wizard, dispatch, sandboxPath, gatewayActions, chrome, onSave }: CommonProps & {
  onSave: () => void;
  sandboxPath: string;
  gatewayActions?: GatewayInstanceActions;
}) {
  return (
    <>
      {view?.kind === "decisions" && (
        <DecisionsModal
          state={wizard}
          modelIds={collectModelIds(wizard.editedProviders)}
          onSubmit={settings => dispatch({ type: "decisions-submit", settings })}
          onProviders={settings => dispatch({ type: "decisions-providers", settings })}
          onBack={() => dispatch({ type: "decisions-back" })}
        />
      )}

      {view?.kind === "theme" && (
        <ThemeModal
          theme={wizard.theme}
          chrome={chrome}
          onSubmit={theme => dispatch({ type: "theme-submit", theme })}
          onBack={() => dispatch({ type: "theme-back" })}
        />
      )}

      {view?.kind === "gateway" && (
        <GatewayModal
          sandbox={sandboxPath}
          port={wizard.gatewayPort}
          gatewayActions={gatewayActions}
          breadcrumb="Home / Configure / Gateway"
          onSubmit={port => dispatch({ type: "gateway-submit", port })}
          onBack={() => dispatch({ type: "gateway-back" })}
        />
      )}

      {view?.kind === "project" && (
        <ProjectModal
          value={wizard.projectDescription}
          onSubmit={description => dispatch({ type: "project-submit", description })}
          onBack={() => dispatch({ type: "project-back" })}
        />
      )}

      {view?.kind === "confirm" && (
        <ConfirmModal
          state={wizard}
          onSave={onSave}
          onBack={() => dispatch({ type: "confirm-back" })}
        />
      )}
    </>
  );
}
