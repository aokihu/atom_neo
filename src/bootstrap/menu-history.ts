// Last successful startup parameters; credentials never enter this file.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";

export const MENU_COMMANDS = ["chat", "core", "config", "core-gateway", "gateway-start", "gateway-stop", "attach", "export", "import"] as const;
export type MenuCommand = typeof MENU_COMMANDS[number];

const parameterSchema = z.object({
  sandbox: z.string().min(1).optional(),
  host: z.string().min(1).optional(),
  port: z.number().int().min(0).max(65535).optional(),
  coreServer: z.string().min(1).optional(),
  corePort: z.number().int().min(1).max(65535).optional(),
  clients: z.string().min(1).optional(),
  continueSession: z.boolean().optional(),
  archive: z.string().min(1).optional(),
  output: z.string().min(1).optional(),
  encrypt: z.boolean().optional(),
});
export type MenuParameters = z.infer<typeof parameterSchema>;
export type MenuHistory = Partial<Record<MenuCommand, MenuParameters>>;

const FIELDS: Record<MenuCommand, (keyof MenuParameters)[]> = {
  chat: ["sandbox", "continueSession"], core: ["sandbox", "host", "port"], config: ["sandbox"],
  "core-gateway": ["sandbox", "host", "port"],
  "gateway-start": ["sandbox", "clients"], "gateway-stop": ["sandbox", "clients"],
  attach: ["coreServer", "corePort"],
  export: ["sandbox", "output", "encrypt"], import: ["archive", "sandbox"],
};

export function menuHistoryPath(): string {
  return join(homedir(), ".config", "atom", "menu_history.json");
}

export function parseMenuParameters(command: MenuCommand, value: unknown): MenuParameters {
  const parsed = parameterSchema.parse(value);
  return Object.fromEntries(FIELDS[command].filter(key => parsed[key] !== undefined).map(key => [key, parsed[key]]));
}

export function readMenuHistory(path = menuHistoryPath()): { commands: MenuHistory; warning?: string } {
  try {
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
    const envelope = z.object({ version: z.literal(1), commands: z.record(z.string(), z.unknown()) }).parse(raw);
    const commands: MenuHistory = {};
    for (const command of MENU_COMMANDS) {
      if (envelope.commands[command] !== undefined) commands[command] = parseMenuParameters(command, envelope.commands[command]);
    }
    return { commands };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { commands: {} };
    return { commands: {}, warning: `Cannot read menu history (${path}); using defaults` };
  }
}

export function saveMenuHistory(command: MenuCommand, parameters: MenuParameters, path = menuHistoryPath()): void {
  const commands = { ...readMenuHistory(path).commands, [command]: parseMenuParameters(command, parameters) };
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify({ version: 1, commands }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}
