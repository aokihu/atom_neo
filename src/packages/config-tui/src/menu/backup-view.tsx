import { useState } from "react";
import { MenuConfirm, MenuPrompt, MenuScreen } from "./menu-frame";
import type { MenuActions } from "./menu-types";

export function BackupView({ workspace, gateway, core, notice, onExport, onImport, onBack }: {
  workspace: string;
  gateway: "online" | "offline" | "unknown";
  core: "online" | "offline" | "unknown";
  notice?: string;
  onExport: () => void;
  onImport: () => void;
  onBack: () => void;
}) {
  return (
    <MenuScreen
      title="Backup"
      workspace={workspace}
      gateway={gateway}
      core={core}
      items={[
        { key: "export", label: "Export ›", detail: "config.json + .env" },
        { key: "import", label: "Import ›", detail: "Restore from .atombak" },
        { key: "back", label: "‹ Back" },
      ]}
      onSelect={(key) => key === "export" ? onExport() : key === "import" ? onImport() : onBack()}
      onBack={onBack}
      hint="↑/↓ move · Enter open · Esc back"
      notice={notice}
    />
  );
}

export function BackupExportView({ actions, title, onDone, onBack }: {
  actions: MenuActions;
  title: string;
  onDone: (message: string) => void;
  onBack: () => void;
}) {
  const [step, setStep] = useState<"output" | "password">("output");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");

  if (step === "output") {
    return (
      <MenuPrompt
        key="export-output"
        title={`${title} / Output`}
        label="Output path (optional)"
        value={output}
        placeholder="atom-backup-<time>.atombak"
        error={error}
        onSubmit={(value) => {
          setOutput(value);
          setError("");
          setStep("password");
        }}
        onCancel={onBack}
        hint="Enter continue · Esc cancel"
      />
    );
  }

  return (
    <MenuPrompt
      key="export-password"
      title={`${title} / Password`}
      label="Password (optional)"
      value=""
      placeholder="Enter to export unencrypted"
      error={error}
      onSubmit={(password) => {
        void actions.exportBackup({ output: output || undefined, password: password || undefined })
          .then(message => onDone(message))
          .catch(caught => setError(caught instanceof Error ? caught.message : String(caught)));
      }}
      onCancel={() => setStep("output")}
      hint="Enter export · Esc back"
    />
  );
}

type ImportStep = "archive" | "password" | "env" | "confirm";

export function BackupImportView({ actions, workspace, gateway, core, title, onDone, onBack }: {
  actions: MenuActions;
  workspace: string;
  gateway: "online" | "offline" | "unknown";
  core: "online" | "offline" | "unknown";
  title: string;
  onDone: (message: string) => void;
  onBack: () => void;
}) {
  const [step, setStep] = useState<ImportStep>("archive");
  const [archive, setArchive] = useState("");
  const [password, setPassword] = useState("");
  const [envMode, setEnvMode] = useState<"merge" | "replace">("merge");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (step === "archive") {
    return (
      <MenuPrompt
        key="import-archive"
        title={`${title} / Archive`}
        label="Archive path"
        value={archive}
        placeholder="/path/to/backup.atombak"
        error={error}
        onSubmit={(value) => {
          if (!value) {
            setError("Archive path is required");
            return;
          }
          setArchive(value);
          setError("");
          setStep("password");
        }}
        onCancel={onBack}
        hint="Enter continue · Esc cancel"
      />
    );
  }

  if (step === "password") {
    return (
      <MenuPrompt
        key="import-password"
        title={`${title} / Password`}
        label="Password (only if encrypted)"
        value={password}
        placeholder="Leave blank for unencrypted archives"
        error={error}
        onSubmit={(value) => {
          setPassword(value);
          setError("");
          setStep("env");
        }}
        onCancel={() => setStep("archive")}
        hint="Enter continue · Esc back"
      />
    );
  }

  if (step === "env") {
    return (
      <MenuScreen
        title={`${title} / .env mode`}
        workspace={workspace}
        gateway={gateway}
        core={core}
        items={[
          { key: "merge", label: "Merge .env", detail: "Keep unrelated keys" },
          { key: "replace", label: "Replace .env", detail: "Overwrite with archive" },
          { key: "back", label: "‹ Back" },
        ]}
        onSelect={(key) => {
          if (key === "back") {
            setStep("password");
            return;
          }
          setEnvMode(key === "replace" ? "replace" : "merge");
          setStep("confirm");
        }}
        onBack={() => setStep("password")}
        hint="↑/↓ move · Enter continue · Esc back"
      />
    );
  }

  return (
    <>
      <MenuConfirm
        title={title}
        message={`Overwrite config.json/.env in ${workspace} from ${archive}?`}
        confirmLabel={busy ? "Importing…" : "Import"}
        onConfirm={() => {
          if (busy) return;
          setBusy(true);
          setError("");
          void actions.importBackup({ archive, envMode, password: password || undefined, force: true })
            .then(message => onDone(message))
            .catch(caught => {
              setError(caught instanceof Error ? caught.message : String(caught));
              setStep("archive");
            })
            .finally(() => setBusy(false));
        }}
        onCancel={() => setStep("env")}
      />
      {error ? <MenuConfirm title={`${title} / Error`} message={error} confirmLabel="Back" onConfirm={() => setStep("archive")} onCancel={() => setStep("archive")} /> : null}
    </>
  );
}
