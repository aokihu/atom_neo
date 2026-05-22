import { createInterface } from "node:readline";
import { TuiClient } from "./client/ws-client";
import { parseArgs } from "node:util";

const c = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  bold: "\x1b[1m",
  hide: "\x1b[?25l",
  show: "\x1b[?25h",
  up: (n: number) => `\x1b[${n}A`,
  clearLine: "\x1b[2K",
};

function parseTuiArgs(rawArgs: string[]): { url?: string } {
  const { values } = parseArgs({
    args: rawArgs,
    options: { url: { type: "string", short: "u", default: "http://127.0.0.1:3100" } },
    allowPositionals: true,
    strict: false,
  });
  return { url: values.url as string };
}

function spinner(): () => void {
  const chars = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  const timer = setInterval(() => {
    process.stderr.write(`\r${c.cyan}${chars[i++ % chars.length]} thinking...${c.reset}`);
  }, 80);
  return () => {
    clearInterval(timer);
    process.stderr.write(`\r${c.clearLine}\r`);
  };
}

async function main() {
  const args = parseTuiArgs(Bun.argv.slice(2));
  const client = new TuiClient({ url: args.url });

  console.log(`${c.bold}${c.cyan}atom_neo${c.reset} ${c.dim}chat${c.reset}`);
  console.log(`${c.dim}session:${c.reset} ${client.sessionId}`);
  console.log(`${c.dim}core:${c.reset}   ${args.url}`);
  console.log(`${c.dim}type /quit to exit${c.reset}\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const ask = () => {
    rl.question(`${c.green}▸ ${c.reset}`, async (input) => {
      if (input === "/quit") { console.log(`${c.dim}Goodbye!${c.reset}`); rl.close(); process.exit(0); }
      if (!input.trim()) { ask(); return; }

      const stop = spinner();
      try {
        const response = await client.send(input);
        stop();
        console.log(`\n${response}\n`);
      } catch (err: any) {
        stop();
        console.log(`\n${c.red}Error: ${err.message}${c.reset}\n`);
      }
      ask();
    });
  };

  ask();
}

main();
