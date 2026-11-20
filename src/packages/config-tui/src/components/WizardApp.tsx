import { useReducer } from "react";
import { ThemeProvider } from "@atom-neo/tui-kit";
import type { ModelEdit } from "./ModelsModal";
import type { GatewayInstanceActions } from "../gateway-status";
import { commit, finalizeEdit } from "../wizard-logic";
import type { WizardMode } from "../wizard-logic";
import { allowDecisionProviders, createWizardUiState, resolveView, wizardReducer } from "../wizard/wizard-reducer";
import type { WizardInitialView } from "../wizard/wizard-reducer";
import { WizardBackground, WizardQuitConfirm } from "../wizard/wizard-overlays";
import { WizardProviderViews, WizardSettingsViews } from "../wizard/WizardViews";
import { ConfigureView } from "../menu/configure-view";

export type WizardChrome = {
  workspace: string;
  gateway: "online" | "offline" | "unknown";
  core: "online" | "offline" | "unknown";
  suspended?: boolean;
  onWorkspace: () => void;
  notice?: string;
  error?: string;
};

export function WizardApp({ sandboxPath, mode, initialView, gatewayActions, onComplete, onAbort, chrome }: {
  sandboxPath: string;
  mode: WizardMode;
  initialView?: WizardInitialView;
  gatewayActions?: GatewayInstanceActions;
  onComplete: () => void;
  onAbort: () => void;
  chrome?: WizardChrome;
}) {
  const [ui, dispatch] = useReducer(wizardReducer, undefined, () => createWizardUiState(mode, sandboxPath, initialView));
  const { wizard, pending } = ui;
  const view = resolveView(ui);
  const allowJev = allowDecisionProviders(ui);

  const submitModels = (patch: ModelEdit) => {
    if (!pending || finalizeEdit(wizard, pending, patch) === null) return false;
    dispatch({ type: "models-submit", patch });
    return true;
  };

  const save = () => {
    commit(sandboxPath, wizard);
    dispatch({ type: "confirm-back" });
    onComplete();
  };

  const embedded = mode === "config" && chrome !== undefined;
  const views = { view, wizard, pending, allowJev, dispatch, chrome };

  return (
    <ThemeProvider theme={wizard.theme}>
      {!embedded ? <WizardBackground /> : null}
      {embedded && view?.kind === "menu" && chrome ? (
        <ConfigureView
          ui={ui}
          dispatch={dispatch}
          workspace={chrome.workspace}
          gateway={chrome.gateway}
          core={chrome.core}
          suspended={chrome.suspended}
          onWorkspace={chrome.onWorkspace}
          notice={chrome.notice}
          error={chrome.error}
        />
      ) : null}
      <WizardProviderViews {...views} onModelsSubmit={submitModels} />
      <WizardSettingsViews {...views} sandboxPath={sandboxPath} gatewayActions={gatewayActions} onSave={save} chrome={chrome} />
      <WizardQuitConfirm
        open={ui.quitConfirm}
        onQuit={onAbort}
        onCancel={() => dispatch({ type: "quit-cancel" })}
      />
    </ThemeProvider>
  );
}
