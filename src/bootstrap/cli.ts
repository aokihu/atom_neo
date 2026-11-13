import { parseArgs } from "node:util";
import { basename, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { parsePortValue } from "@atom-neo/shared";
export type { LogLevel } from "@atom-neo/shared";
import type { LogLevel } from "@atom-neo/shared";

export type Mode = "core" | "tui" | "core-gateway" | "gateway" | "full";
export type LogMode = "console" | "pipe" | "file";
export type Command = "export" | "import";
export type BackupEnvMode = "merge" | "replace";

export type BootArguments = {
  menu: boolean;
  wizard: boolean;
  command?: Command;
  archive?: string;
  output?: string;
  password: boolean;
  force: boolean;
  dryRun: boolean;
  envMode: BackupEnvMode;
  sandboxExplicit: boolean;
  mode?: Mode;
  port: number;
  host: string;
  sandbox: string;
  logLevel: LogLevel;
  logIgnore: LogLevel[];
  logLevelExplicit: boolean;
  logIgnoreExplicit: boolean;
  logModes: LogMode[];
  logFile?: string;
  logPipePath?: string;
  coreServer?: string;
  corePort?: number;
  clients?: string;
  action?: "start" | "stop";
  config: boolean;
  continueSession: boolean;
};

export function parseArguments(rawArgs: readonly string[]): BootArguments | "help" {
  const first = rawArgs[0];
  const menu = first === "menu";
  const command: Command | undefined = first === "export" || first === "import" ? first : undefined;
  const { values, tokens, positionals } = parseArgs({
    args: menu || command ? rawArgs.slice(1) : [...rawArgs],
    options: {
      wizard: { type: "boolean" },
      continue: { type: "boolean", short: "c", default: false },
      help: { type: "boolean", short: "h", default: false },
      mode: { type: "string", short: "m" },
      port: { type: "string", default: "3100" },
      host: { type: "string", default: "127.0.0.1" },
      sandbox: { type: "string" },
      "core-server": { type: "string" },
      "core-port": { type: "string" },
      clients: { type: "string" },
      action: { type: "string" },
      config: { type: "boolean", default: false },
      output: { type: "string", short: "o" },
      password: { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      env: { type: "string", default: "merge" },
      log: { type: "string", multiple: true, default: [] },
      "log-level": { type: "string", default: "debug" },
      "log-ignore": { type: "string", multiple: true, default: [] },
      "log-file": { type: "string" },
      "log-pipepath": { type: "string" },
    },
    tokens: true,
    allowPositionals: command === "import",
    strict: true,
  });

  if (values.help) return "help";

  if (menu && tokens.some(t => t.kind === "option" && t.name !== "sandbox")) {
    throw new Error("menu only accepts --sandbox; choose commands and parameters in the wizard");
  }
  if (command) validateCommandArguments(command, tokens, positionals);
  if (!command && tokens.some(token => token.kind === "option" && ["output", "password", "force", "dry-run", "env"].includes(token.name))) {
    throw new Error("--output/--password/--force/--dry-run/--env require export or import");
  }
  if (values.output === "") throw new Error("--output cannot be empty");

  const sandboxPath = values.sandbox;
  if (sandboxPath === "") throw new Error("--sandbox cannot be empty");
  const sandbox = parseSandboxPath(sandboxPath ?? process.cwd());

  const modeExplicit = tokens?.some((t: any) =>
    t.kind === "option" && (t.name === "mode" || t.name === "m"),
  );
  const logLevelExplicit = tokens?.some((t: any) =>
    t.kind === "option" && t.name === "log-level",
  ) ?? false;
  const logIgnoreExplicit = tokens?.some((t: any) =>
    t.kind === "option" && t.name === "log-ignore",
  ) ?? false;

  const mode = modeExplicit ? validateMode(values.mode as string) : undefined;
  if (mode === "tui" && (!values["core-server"] || !values["core-port"])) throw new Error("TUI requires --core-server and --core-port");
  if (mode === "gateway" && !values.action) throw new Error("Gateway control requires --action start|stop");
  if (mode !== "tui" && (values["core-server"] !== undefined || values["core-port"] !== undefined)) throw new Error("Core connection options require --mode tui");
  if (mode !== "gateway" && (values.clients !== undefined || values.action !== undefined)) throw new Error("Client control options require --mode gateway");
  if (values.clients !== undefined && !(values.clients as string).trim()) throw new Error("--clients cannot be empty");
  if ((mode === "tui" || mode === "gateway") && tokens?.some(t => t.kind === "option" && ["host", "port"].includes(t.name))) throw new Error("--host/--port are server listening options");
  return {
    menu,
    wizard: values.wizard === true,
    command,
    archive: command === "import" ? resolve(positionals[0]) : undefined,
    output: command === "export" ? values.output as string | undefined : undefined,
    password: command ? values.password as boolean : false,
    force: command ? values.force as boolean : false,
    dryRun: command ? values["dry-run"] as boolean : false,
    envMode: command ? validateEnum(values.env as string, ["merge", "replace"] as const, "--env") : "merge",
    sandboxExplicit: sandboxPath !== undefined,
    coreServer: values["core-server"] as string | undefined,
    corePort: values["core-port"] === undefined ? undefined : parsePort(values["core-port"] as string, false),
    clients: values.clients as string | undefined,
    action: values.action === undefined ? undefined : validateEnum(values.action as string, ["start", "stop"] as const, "action"),
    mode,
    port: parsePort(values.port as string, true),
    host: values.host as string,
    sandbox,
    logLevel: validateLogLevel(values["log-level"] as string),
    logIgnore: (values["log-ignore"] as string[]).map(validateLogLevel),
    logLevelExplicit,
    logIgnoreExplicit,
    logModes: (values.log as string[]).map(validateLogMode),
    logFile: values["log-file"] as string | undefined,
    logPipePath: values["log-pipepath"] as string | undefined,
    config: values.config as boolean,
    continueSession: values.continue as boolean,
  };
}

function validateCommandArguments(command: Command, tokens: readonly { kind: string; name?: string }[], positionals: readonly string[]): void {
  const allowed = command === "export"
    ? ["sandbox", "output", "password", "force", "help"]
    : ["sandbox", "password", "force", "dry-run", "env", "help"];
  const invalid = tokens.find(token => token.kind === "option" && token.name !== undefined && !allowed.includes(token.name));
  if (invalid?.name) throw new Error(`${command} does not accept --${invalid.name}`);
  if (command === "import" && (positionals.length !== 1 || !positionals[0].trim())) throw new Error("import requires exactly one archive path");
}

export function printHelp(): void {
  const binName = applicationCommandName();

  console.log(`
atom-neo — AI Agent Development Platform

USAGE
  ${binName} [OPTIONS]
  ${binName} menu [--sandbox <path>]
  ${binName} export [--sandbox <path>] [-o|--output <file>] [--password] [--force]
  ${binName} import <archive> [--sandbox <path>] [--password] [--env merge|replace] [--dry-run] [--force]

COMMANDS
  menu                   一次性启动向导（参数自动回填，完成后执行）
  export                 导出 config.json + .env 为 .atombak 归档
  import                 从 .atombak 归档导入配置

OPTIONS
  -m, --mode <mode>      运行模式: core | core-gateway | tui | gateway (默认: core + TUI)
  --port <port>           监听端口 (默认: 3100；0 为随机)
  --host <host>           绑定地址 (默认: 127.0.0.1)
  --core-server <host>    TUI attach 的 Core 主机（必填）
  --core-port <port>      TUI attach 的 Core 端口（必填）
                         远程连接需双方设置 ATOM_ADMIN_TOKEN
  --action <start|stop>   Gateway Client 控制动作（必填）
  --clients <id>         指定 Client；省略则操作全部
  --sandbox <path>        沙箱目录 (默认: 当前目录)
  -c, --continue         继续上次 TUI Session（默认新建；无历史时新建）
  --config                启动配置向导 (API Key / 模型 / Provider / 主题)
  --log <mode>            日志输出模式: console | pipe | file (可叠加使用)
  --log-level <level>     日志级别: debug | info | warn | error (默认: debug)
  --log-ignore <level>    忽略的日志级别 (可多次使用)
  --log-file <path>       日志文件路径 (--log=file 时必需)
  --log-pipepath <path>   命名管道路径 (--log=pipe 时必需)
  -o, --output <file>     导出归档路径 (默认: atom-backup-<time>.atombak)
  --password              提示输入密码加密/解密归档 (或使用 ATOM_BACKUP_PASSWORD)
  --env <mode>            导入 .env 策略: merge | replace (默认: merge)
  --dry-run               仅显示导入计划，不写盘
  --force                 覆盖已有归档/文件，跳过导入确认
  -h, --help              显示此帮助信息

EXAMPLES
  ${binName} menu
  ${binName} --sandbox ./sandbox
  ${binName} --continue --sandbox ./sandbox
  ${binName} --mode core --port 3100 --log=console
  ${binName} --mode core-gateway --port 3100 --log=console
  ${binName} --config --sandbox ./sandbox
  ${binName} export --sandbox ./sandbox --password -o ./backup.atombak
  ${binName} import ./backup.atombak --sandbox ./sandbox
`);
}

function validateMode(v: string): Mode {
  return validateEnum(v, ["core", "tui", "core-gateway", "gateway", "full"] as const, "mode");
}

function validateLogLevel(v: string): LogLevel {
  return validateEnum(v, ["debug", "info", "warn", "error"] as const, "--log-level");
}

function validateLogMode(v: string): LogMode {
  return validateEnum(v, ["console", "pipe", "file"] as const, "--log");
}

function validateEnum<T extends string>(v: string, valid: readonly T[], label: string): T {
  if (valid.includes(v as T)) return v as T;
  throw new Error(`Invalid ${label}: ${v}. Expected ${valid.join(" | ")}`);
}

export function parseSandboxPath(value: string): string {
  if (!value.trim()) throw new Error("--sandbox cannot be empty");
  return value === "~" ? homedir() : value.startsWith("~/") ? resolve(homedir(), value.slice(2)) : resolve(value);
}

/** Compiled Bun entrypoints live under the virtual /$bunfs root and cannot be re-executed. */
const BUN_VIRTUAL_ROOT = "/$bunfs/";

export type RuntimeName = "bun" | "node";

function currentRuntime(): RuntimeName {
  return process.versions.bun ? "bun" : "node";
}

/** Source entrypoint; undefined for compiled Bun binaries and `node -e`. */
export function sourceEntrypoint(): string | undefined {
  const entrypoint = process.argv[1];
  return !entrypoint || entrypoint.startsWith(BUN_VIRTUAL_ROOT) ? undefined : entrypoint;
}

function displayEntrypoint(entrypoint: string, cwd: string): string {
  const path = relative(cwd, entrypoint);
  return path && path !== ".." && !path.startsWith(`..${sep}`) ? path : entrypoint;
}

/** Command prefix for help text and menu previews. */
export function applicationCommandName(
  runtime: RuntimeName = currentRuntime(),
  entrypoint: string | null = sourceEntrypoint() ?? null,
  executable: string = process.execPath,
  cwd: string = process.cwd(),
): string {
  if (runtime === "bun" && !entrypoint) return "atom";
  if (!entrypoint) return basename(executable);
  const display = displayEntrypoint(entrypoint, cwd);
  return runtime === "bun" ? `bun run ${display}` : `${basename(executable)} ${display}`;
}

/**
 * Build a command that re-enters the application.
 * Bun source uses `bun run <entrypoint>`; compiled binaries and Node invoke the entrypoint directly.
 */
export function buildAppCommand(
  args: readonly string[],
  entrypoint: string | null = sourceEntrypoint() ?? null,
  executable: string = process.execPath,
  runtime: RuntimeName = currentRuntime(),
): string[] {
  const entry = runtime === "bun" && entrypoint
    ? ["run", entrypoint]
    : entrypoint ? [entrypoint] : [];
  return [executable, ...entry, ...args];
}

export function parsePort(value: string, allowZero: boolean): number {
  const port = parsePortValue(value, { allowZero });
  if (port === undefined) throw new Error(`Invalid port: ${value}`);
  return port;
}
