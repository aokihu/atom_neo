import type { SessionSummary } from "@atom-neo/shared";
import type { GatewayInstanceActions } from "../gateway-status";

export type { SessionSummary } from "@atom-neo/shared";

export type MenuInitialRoute = "home" | "configure" | "gateway";

export type MenuLaunch =
  | { kind: "chat"; sandbox: string; continueSession: boolean }
  | { kind: "core"; sandbox: string; host: string; port: number }
  | { kind: "attach"; sandbox: string; host: string; port: number; sessionId?: string };

export type BackupExportInput = {
  output?: string;
  password?: string;
  force?: boolean;
};

export type BackupImportInput = {
  archive: string;
  envMode: "merge" | "replace";
  password?: string;
};

/** Injected by bootstrap; config-tui must not import bootstrap modules. */
export type MenuActions = {
  theme: string;
  gatewayPort: number;
  gateway: GatewayInstanceActions;
  hasConfig: (workspace: string) => boolean;
  validateWorkspace: (workspace: string) => string | undefined;
  /** Returns the normalized absolute workspace path without activating it. */
  normalizeWorkspace: (workspace: string) => string;
  /** Returns the normalized absolute workspace path. */
  setWorkspace: (workspace: string) => string;
  refreshSettings: () => { theme: string; gatewayPort: number };
  coreStatus: () => Promise<"online" | "offline">;
  coreTarget: () => Promise<{ host: string; port: number }>;
  coreStartTarget: () => { host: string; port: number };
  gatewayStatus: () => Promise<"online" | "offline">;
  listSessions: () => Promise<SessionSummary[]>;
  deleteSession: (sessionId: string) => Promise<void>;
  stopCore: () => Promise<void>;
  exportBackup: (input: BackupExportInput) => Promise<string>;
  importBackup: (input: BackupImportInput) => Promise<string>;
  /** Returns a validation error, or undefined when the password is acceptable. */
  validateBackupPassword: (password: string) => string | undefined;
  inspectBackup: (archive: string) => Promise<{ encrypted: boolean }>;
  setGatewayPort: (port: number) => void;
};
