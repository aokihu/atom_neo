import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { homedir } from "node:os";
export type { LogLevel } from "@atom-neo/shared";
import type { LogLevel } from "@atom-neo/shared";

export type Mode = "core" | "tui" | "core-gateway" | "gateway" | "full";
export type LogMode = "console" | "pipe" | "file";

export type BootArguments = {
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

export function parseArguments(rawArgs: string[]): BootArguments | "help" {
  const { values, tokens } = parseArgs({
    args: rawArgs,
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
      log: { type: "string", multiple: true, default: [] },
      "log-level": { type: "string", default: "debug" },
      "log-ignore": { type: "string", multiple: true, default: [] },
      "log-file": { type: "string" },
      "log-pipepath": { type: "string" },
    },
    tokens: true,
    allowPositionals: false,
    strict: true,
  });

  if (values.help) return "help";

  const sandboxPath = values.sandbox;
  if (sandboxPath === "") throw new Error("--sandbox cannot be empty");
  const sandbox = sandboxPath === undefined ? process.cwd()
    : sandboxPath === "~" ? homedir()
    : sandboxPath.startsWith("~/") ? resolve(homedir(), sandboxPath.slice(2))
    : resolve(sandboxPath);

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

export function printHelp(): void {
  const binName = (Bun.main || "").endsWith("atom") ? "atom" : "bun run src/main.ts";

  console.log(`
atom-neo — AI Agent Development Platform

USAGE
  ${binName} [OPTIONS]

OPTIONS
  -m, --mode <mode>      运行模式: core | core-gateway | tui | gateway (默认: core + TUI)
  --port <port>           监听端口 (默认: 3100；0 为随机)
  --host <host>           绑定地址 (默认: 127.0.0.1)
  --core-server <host>    TUI attach 的 Core 主机（必填）
  --core-port <port>      TUI attach 的 Core 端口（必填）
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
  -h, --help              显示此帮助信息

EXAMPLES
  ${binName} --sandbox ./sandbox
  ${binName} --continue --sandbox ./sandbox
  ${binName} --mode core --port 3100 --log=console
  ${binName} --mode core-gateway --port 3100 --log=console
  ${binName} --config --sandbox ./sandbox
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

function parsePort(value: string, allowZero: boolean): number {
  const port = Number(value);
  if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < (allowZero ? 0 : 1) || port > 65535) throw new Error(`Invalid port: ${value}`);
  return port;
}
