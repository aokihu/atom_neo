import { useState } from "react";
import { Modal } from "../modal";
import type { ModalAction } from "../modal";
import { ThemeProvider, useTheme } from "../theme";
import { buildInitialState, beginEdit, beginNewProvider, updatePendingApiKey, finalizeEdit, collectModelIds, commit } from "../wizard-logic";
import type { WizardMode, WizardState, PendingEdit, ThinkingMode } from "../wizard-logic";
import { MenuModal } from "./MenuModal";
import type { MenuKey } from "./MenuModal";
import { ProvidersModal } from "./ProvidersModal";
import { ApiKeyModal } from "./ApiKeyModal";
import { ModelsModal } from "./ModelsModal";
import { ProfilesModal } from "./ProfilesModal";
import { ThemeModal } from "./ThemeModal";
import { GatewayModal } from "./GatewayModal";
import { ProjectModal } from "./ProjectModal";
import { ConfirmModal } from "./ConfirmModal";

const QUIT_ACTIONS: ModalAction[] = [
  { key: "cancel", label: "Cancel", role: "cancel" },
  { key: "quit", label: "Quit", role: "destructive", variant: "danger" },
];

type View = "menu" | "providers" | "apikey" | "models" | "profiles" | "theme" | "gateway" | "project" | "confirm";

export function WizardApp({ sandboxPath, mode, onComplete, onAbort }: {
  sandboxPath: string;
  mode: WizardMode;
  onComplete: () => void;
  onAbort: () => void;
}) {
  const [wizard, setWizard] = useState<WizardState>(() => buildInitialState(mode, sandboxPath));
  const [pending, setPending] = useState<PendingEdit | null>(null);
  const [view, setView] = useState<View>(mode === "config" ? "menu" : "providers");
  const [quitConfirm, setQuitConfirm] = useState(false);

  const cancelEdit = () => {
    setPending(null);
    setView("providers");
  };

  const selectProvider = (id: string) => {
    const { state, pending: p } = beginEdit(wizard, id);
    if (!p) return;
    setPending(p);
    setWizard(state);
    setView("apikey");
  };

  const addProvider = (id: string) => {
    const { state, pending: p } = beginNewProvider(wizard, id);
    setPending(p);
    setWizard(state);
    setView("apikey");
  };

  const submitApiKey = (apiKey: string, baseUrl?: string, env?: string) => {
    if (!pending) return;
    const { state, pending: p } = updatePendingApiKey(wizard, pending, apiKey, baseUrl, env);
    setPending(p);
    setWizard(state);
    setView("models");
  };

  const submitModels = (patch: { models: string[]; baseUrl?: string; thinking: ThinkingMode; contextLimit?: number }) => {
    if (!pending) return;
    const next = finalizeEdit(wizard, pending, patch);
    if (next === null) return;
    setPending(null);
    setWizard(next);
    setView(mode === "config" ? "providers" : "profiles");
  };

  const submitProfiles = (profiles: WizardState["profiles"]) => {
    setWizard(w => ({ ...w, profiles }));
    setView(mode === "config" ? "menu" : "theme");
  };

  const submitTheme = (theme: string) => {
    setWizard(w => ({ ...w, theme }));
    setView(mode === "config" ? "menu" : "project");
  };

  const submitGateway = (port: number) => {
    setWizard(w => ({ ...w, gatewayPort: port }));
    setView("menu");
  };

  const submitProject = (desc: string) => {
    setWizard(w => ({ ...w, projectDescription: desc }));
    setView("confirm");
  };

  const save = () => {
    commit(sandboxPath, wizard);
    onComplete();
  };

  const modelIds = collectModelIds(wizard.editedProviders);
  const provider = pending?.id ?? wizard.provider;
  const isNewProvider = pending?.isNew ?? false;

  return (
    <ThemeProvider theme={wizard.theme}>
      <Background />

      {!quitConfirm && mode === "config" && (
        <>
          {view === "menu" && (
            <MenuModal
              state={wizard}
              onSelect={(key: MenuKey) => {
                switch (key) {
                  case "providers": setView("providers"); break;
                  case "profiles": setView("profiles"); break;
                  case "theme": setView("theme"); break;
                  case "gateway": setView("gateway"); break;
                  case "save": setView("confirm"); break;
                }
              }}
              onClose={() => setQuitConfirm(true)}
            />
          )}
          {view === "providers" && (
            <ProvidersModal
              providers={Object.keys(wizard.editedProviders)}
              onSelect={selectProvider}
              onAdd={addProvider}
              onBack={() => setView("menu")}
            />
          )}
        </>
      )}

      {!quitConfirm && mode === "first-run" && view === "providers" && (
        <ProvidersModal
          providers={Object.keys(wizard.editedProviders)}
          onSelect={selectProvider}
          onAdd={addProvider}
          onBack={() => setQuitConfirm(true)}
        />
      )}

      {!quitConfirm && view === "apikey" && (
        <ApiKeyModal
          provider={provider}
          apiKey={wizard.apiKey}
          apiKeyEnv={wizard.apiKeyEnv}
          baseUrl={wizard.customBaseUrl}
          showEnv={mode === "config" ? !wizard.apiKeyEnv : wizard.provider === "custom" || isNewProvider}
          showBaseUrl={mode === "first-run" && wizard.provider === "custom"}
          onSubmit={submitApiKey}
          onCancel={cancelEdit}
        />
      )}

      {!quitConfirm && view === "models" && (
        <ModelsModal
          provider={provider}
          models={wizard.models}
          baseUrl={wizard.customBaseUrl}
          thinking={wizard.thinking}
          contextLimit={wizard.contextLimit}
          onSubmit={submitModels}
          onCancel={mode === "config" ? cancelEdit : () => setView("apikey")}
        />
      )}

      {!quitConfirm && view === "profiles" && (
        <ProfilesModal
          profiles={wizard.profiles}
          modelIds={modelIds}
          onSubmit={submitProfiles}
          onBack={() => setView(mode === "config" ? "menu" : "models")}
        />
      )}

      {!quitConfirm && view === "theme" && (
        <ThemeModal
          theme={wizard.theme}
          onSubmit={submitTheme}
          onBack={() => setView(mode === "config" ? "menu" : "profiles")}
        />
      )}

      {!quitConfirm && view === "gateway" && mode === "config" && (
        <GatewayModal
          port={wizard.gatewayPort}
          onSubmit={submitGateway}
          onBack={() => setView("menu")}
        />
      )}

      {!quitConfirm && view === "project" && mode === "first-run" && (
        <ProjectModal
          value={wizard.projectDescription}
          onSubmit={submitProject}
          onBack={() => setView("theme")}
        />
      )}

      {!quitConfirm && view === "confirm" && (
        <ConfirmModal
          state={wizard}
          onSave={save}
          onBack={() => setView(mode === "config" ? "menu" : "project")}
        />
      )}

      <QuitConfirm open={quitConfirm} onQuit={onAbort} onCancel={() => setQuitConfirm(false)} />
    </ThemeProvider>
  );
}

function Background() {
  const { colors } = useTheme();
  return (
    <box width="100%" height="100%" backgroundColor={colors.bg.page} />
  );
}

function QuitConfirm({ open, onQuit, onCancel }: { open: boolean; onQuit: () => void; onCancel: () => void }) {
  const { colors } = useTheme();
  return (
    <Modal
      open={open}
      title="QUIT WITHOUT SAVING?"
      width={48}
      zIndex={1200}
      actions={QUIT_ACTIONS}
      defaultActionKey="cancel"
      onClose={onCancel}
      onAction={(key) => { if (key === "quit") onQuit(); else onCancel(); }}
    >
      <text fg={colors.text.secondary}>All unsaved changes will be discarded.</text>
    </Modal>
  );
}
