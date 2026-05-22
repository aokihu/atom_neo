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

export function parseArguments(rawArgs: string[]): BootArguments {
  const { values } = parseArgs({
    args: rawArgs,
    options: {
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

function validateMode(v: string): Mode {
  if (["core", "tui", "full"].includes(v)) return v as Mode;
  throw new Error(`Invalid mode: ${v}. Expected core | tui | full`);
}

function validateLogLevel(v: string): LogLevel {
  if (["debug", "info", "warn", "error"].includes(v)) return v as LogLevel;
  throw new Error(`Invalid --log-level: ${v}. Expected debug | info | warn | error`);
}
