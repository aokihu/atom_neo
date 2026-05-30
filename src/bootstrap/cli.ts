import { parseArgs } from "node:util";
import { resolve } from "node:path";
export type { LogLevel } from "@atom-neo/shared";
import type { LogLevel } from "@atom-neo/shared";

export type Mode = "core" | "tui" | "full";
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
};

export function parseArguments(rawArgs: string[]): BootArguments | "help" {
  const { values, tokens } = parseArgs({
    args: rawArgs,
    options: {
      help: { type: "boolean", short: "h", default: false },
      mode: { type: "string", short: "m" },
      port: { type: "string", default: "0" },
      host: { type: "string", default: "127.0.0.1" },
      sandbox: { type: "string" },
      log: { type: "string", multiple: true, default: [] },
      "log-level": { type: "string", default: "debug" },
      "log-ignore": { type: "string", multiple: true, default: [] },
      "log-file": { type: "string" },
      "log-pipepath": { type: "string" },
    },
    tokens: true,
    allowPositionals: true,
    strict: false,
  });

  if (values.help) return "help";

  const sandbox = values.sandbox
    ? resolve(values.sandbox as string)
    : process.cwd();

  const modeExplicit = tokens?.some((t: any) =>
    t.kind === "option" && (t.name === "mode" || t.name === "m"),
  );
  const logLevelExplicit = tokens?.some((t: any) =>
    t.kind === "option" && t.name === "log-level",
  ) ?? false;
  const logIgnoreExplicit = tokens?.some((t: any) =>
    t.kind === "option" && t.name === "log-ignore",
  ) ?? false;

  return {
    mode: modeExplicit ? validateMode(values.mode as string) : undefined,
    port: parseInt(values.port as string) || 0,
    host: values.host as string,
    sandbox,
    logLevel: validateLogLevel(values["log-level"] as string),
    logIgnore: (values["log-ignore"] as string[]).map(validateLogLevel),
    logLevelExplicit,
    logIgnoreExplicit,
    logModes: (values.log as string[]).map(validateLogMode),
    logFile: values["log-file"] as string | undefined,
    logPipePath: values["log-pipepath"] as string | undefined,
  };
}

export function printHelp(): void {
  const binName = (Bun.main || "").endsWith("atom") ? "atom" : "bun run src/main.ts";

  console.log(`
atom-neo — AI Agent Development Platform

USAGE
  ${binName} [OPTIONS]

OPTIONS
  -m, --mode <mode>      运行模式: core | full (默认: core + TUI 交互模式)
  --port <port>           监听端口 (默认: 0, 随机)
  --host <host>           绑定地址 (默认: 127.0.0.1)
  --sandbox <path>        沙箱目录 (默认: 当前目录)
  --log <mode>            日志输出模式: console | pipe | file (可叠加使用)
  --log-level <level>     日志级别: debug | info | warn | error (默认: debug)
  --log-ignore <level>    忽略的日志级别 (可多次使用)
  --log-file <path>       日志文件路径 (--log=file 时必需)
  --log-pipepath <path>   命名管道路径 (--log=pipe 时必需)
  -h, --help              显示此帮助信息

EXAMPLES
  ${binName} --sandbox ./sandbox
  ${binName} --mode core --port 3100 --log=console
  ${binName} --mode full --port 3100 --log=console
`);
}

function validateMode(v: string): Mode {
  if (["core", "tui", "full"].includes(v)) return v as Mode;
  throw new Error(`Invalid mode: ${v}. Expected core | tui | full`);
}

function validateLogLevel(v: string): LogLevel {
  if (["debug", "info", "warn", "error"].includes(v)) return v as LogLevel;
  throw new Error(`Invalid --log-level: ${v}. Expected debug | info | warn | error`);
}

function validateLogMode(v: string): LogMode {
  if (["console", "pipe", "file"].includes(v)) return v as LogMode;
  throw new Error(`Invalid --log: ${v}. Expected console | pipe | file`);
}
