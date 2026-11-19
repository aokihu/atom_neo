import type { GatewayInstanceActions } from "../gateway-status";

export type MenuInitialRoute = "home" | "configure" | "gateway";

export type SessionSummary = {
  sessionId: string;
  lastTuiUsedAt: number;
  initiator: { type: string };
  status: string;
  active: boolean;
};

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
  force: boolean;
};

/** Injected by bootstrap; config-tui must not import bootstrap modules. */
export type MenuActions = {
  theme: string;
  gatewayPort: number;
  gateway: GatewayInstanceActions;
  hasConfig: (workspace: string) => boolean;
  validateWorkspace: (workspace: string) => string | undefined;
  setWorkspace: (workspace: string) => void;
  coreStatus: () => Promise<"online" | "offline">;
  coreTarget: () => Promise<{ host: string; port: number }>;
  gatewayStatus: () => Promise<"online" | "offline">;
  listSessions: () => Promise<SessionSummary[]>;
  deleteSession: (sessionId: string) => Promise<void>;
  stopCore: () => Promise<void>;
  exportBackup: (input: BackupExportInput) => Promise<string>;
  importBackup: (input: BackupImportInput) => Promise<string>;
  setGatewayPort: (port: number) => void;
};
