import { useReducer } from "react";
import { ThemeProvider } from "@atom-neo/tui-kit";
import type { ModelEdit } from "./ModelsModal";
import type { GatewayInstanceActions } from "../gateway-status";
import { commit, finalizeEdit } from "../wizard-logic";
import type { WizardMode } from "../wizard-logic";
import { allowDecisionProviders, createWizardUiState, resolveView, wizardReducer } from "../wizard/wizard-reducer";
import { WizardBackground, WizardQuitConfirm } from "../wizard/wizard-overlays";
import { WizardProviderViews, WizardSettingsViews } from "../wizard/WizardViews";

export function WizardApp({ sandboxPath, mode, gatewayActions, onComplete, onAbort }: {
  sandboxPath: string;
  mode: WizardMode;
  gatewayActions?: GatewayInstanceActions;
  onComplete: () => void;
  onAbort: () => void;
}) {
  const [ui, dispatch] = useReducer(wizardReducer, undefined, () => createWizardUiState(mode, sandboxPath));
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
    onComplete();
  };

  const views = { view, wizard, pending, allowJev, dispatch };

  return (
    <ThemeProvider theme={wizard.theme}>
      <WizardBackground />
      <WizardProviderViews {...views} onModelsSubmit={submitModels} />
      <WizardSettingsViews {...views} sandboxPath={sandboxPath} gatewayActions={gatewayActions} onSave={save} />
      <WizardQuitConfirm
        open={ui.quitConfirm}
        onQuit={onAbort}
        onCancel={() => dispatch({ type: "quit-cancel" })}
      />
    </ThemeProvider>
  );
}
