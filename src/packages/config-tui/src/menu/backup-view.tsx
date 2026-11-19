import { useState } from "react";
import { MenuConfirm, MenuPrompt, MenuScreen, MenuSecretPrompt } from "./menu-frame";
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

type ExportStep = "output" | "password" | "confirm-password" | "plaintext-confirm";

export function BackupExportView({ actions, title, onDone, onBack }: {
  actions: MenuActions;
  title: string;
  onDone: (message: string) => void;
  onBack: () => void;
}) {
  const [step, setStep] = useState<ExportStep>("output");
  const [output, setOutput] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const runExport = (value?: string) => {
    void actions.exportBackup({ output: output || undefined, password: value })
      .then(message => onDone(message))
      .catch(caught => {
        setError(caught instanceof Error ? caught.message : String(caught));
        setStep("password");
      });
  };

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

  if (step === "password") {
    return (
      <MenuSecretPrompt
        key="export-password"
        title={`${title} / Password`}
        label="Password (leave blank for plaintext)"
        placeholder="Leave blank for unencrypted export"
        error={error}
        onSubmit={(value) => {
          if (!value) {
            setPassword("");
            setError("");
            setStep("plaintext-confirm");
            return;
          }
          const problem = actions.validateBackupPassword(value);
          if (problem) {
            setError(problem);
            return;
          }
          setPassword(value);
          setError("");
          setStep("confirm-password");
        }}
        onCancel={() => setStep("output")}
        hint="Enter continue · Esc back"
      />
    );
  }

  if (step === "confirm-password") {
    return (
      <MenuSecretPrompt
        key="export-confirm-password"
        title={`${title} / Confirm password`}
        label="Confirm password"
        error={error}
        onSubmit={(value) => {
          if (value !== password) {
            setError("Passwords do not match");
            return;
          }
          setError("");
          runExport(password);
        }}
        onCancel={() => setStep("password")}
        hint="Enter export · Esc back"
      />
    );
  }

  return (
    <MenuConfirm
      title={`${title} / Plaintext warning`}
      message="Export without a password? The archive will contain plaintext API keys."
      confirmLabel="Export plaintext"
      onConfirm={() => runExport(undefined)}
      onCancel={() => setStep("password")}
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
  const [encrypted, setEncrypted] = useState(false);
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
          setBusy(true);
          void actions.inspectBackup(value).then(summary => {
            setEncrypted(summary.encrypted);
            setStep(summary.encrypted ? "password" : "env");
          }).catch(caught => setError(caught instanceof Error ? caught.message : String(caught)))
            .finally(() => setBusy(false));
        }}
        onCancel={onBack}
        hint={busy ? "Inspecting archive…" : "Enter continue · Esc cancel"}
      />
    );
  }

  if (step === "password") {
    return (
      <MenuSecretPrompt
        key="import-password"
        title={`${title} / Password`}
        label="Archive password"
        placeholder="Encrypted archive"
        error={error}
        onSubmit={(value) => {
          if (!value) {
            setError("Password is required for an encrypted archive");
            return;
          }
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
            setStep(encrypted ? "password" : "archive");
            return;
          }
          setEnvMode(key === "replace" ? "replace" : "merge");
          setStep("confirm");
        }}
        onBack={() => setStep(encrypted ? "password" : "archive")}
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
          void actions.importBackup({ archive, envMode, password: password || undefined })
            .then(message => onDone(message))
            .catch(caught => {
              setError(caught instanceof Error ? caught.message : String(caught));
              setStep(encrypted ? "password" : "archive");
            })
            .finally(() => setBusy(false));
        }}
        onCancel={() => setStep("env")}
      />
    </>
  );
}
