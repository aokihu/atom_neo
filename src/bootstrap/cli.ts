import { parseArgs } from "node:util";
import { resolve } from "node:path";

export type Mode = "core" | "tui" | "full";
export type LogLevel = "debug" | "info" | "warn" | "error";

export type BootArguments = {
  mode: Mode;
  port: number;
  host: string;
  sandbox: string;
  logLevel: LogLevel;
  logIgnore: LogLevel[];
  logFile?: string;
  logPipePath?: string;
};

export function parseArguments(rawArgs: string[]): BootArguments | "help" {
  const { values } = parseArgs({
    args: rawArgs,
    options: {
      help: { type: "boolean", short: "h", default: false },
      mode: { type: "string", short: "m", default: "core" },
      port: { type: "string", default: "0" },
      host: { type: "string", default: "127.0.0.1" },
      sandbox: { type: "string" },
      "log-level": { type: "string", default: "debug" },
      "log-ignore": { type: "string", multiple: true, default: [] },
      "log-file": { type: "string" },
      "log-pipepath": { type: "string" },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values.help) return "help";

  const sandbox = values.sandbox
    ? resolve(values.sandbox as string)
    : process.cwd();

  return {
    mode: validateMode(values.mode as string),
    port: parseInt(values.port as string) || 0,
    host: values.host as string,
    sandbox,
    logLevel: validateLogLevel(values["log-level"] as string),
    logIgnore: (values["log-ignore"] as string[]).map(validateLogLevel),
    logFile: values["log-file"] as string | undefined,
    logPipePath: values["log-pipepath"] as string | undefined,
  };
}

export function printHelp(): void {
  console.log(`
atom-neo — AI Agent Development Platform

USAGE
  bun run src/main.ts [OPTIONS]

OPTIONS
  -m, --mode <mode>      运行模式: core | tui | full (默认: core)
  --port <port>           监听端口 (默认: 0, 随机)
  --host <host>           绑定地址 (默认: 127.0.0.1)
  --sandbox <path>        沙箱目录 (默认: 当前目录)
  --log-level <level>     日志级别: debug | info | warn | error (默认: debug)
  --log-ignore <level>    忽略的日志级别 (可多次使用)
  --log-file <path>       日志输出文件
  --log-pipepath <path>   日志管道路径
  -h, --help              显示此帮助信息

EXAMPLES
  bun run src/main.ts --port 3100 --sandbox ./sandbox --log-file /tmp/atom-debug
  bun run src/main.ts -m full --port 3000 --sandbox /home/user/project
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
