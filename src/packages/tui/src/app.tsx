import { createInterface } from "node:readline";
import { TuiClient } from "./client/ws-client";
import { parseArgs } from "node:util";

function parseTuiArgs(rawArgs: string[]): { url?: string; sessionId?: string } {
  const { values } = parseArgs({
    args: rawArgs,
    options: {
      url: { type: "string", short: "u" },
      session: { type: "string", short: "s" },
    },
    allowPositionals: true,
    strict: false,
  });
  return { url: values.url as string, sessionId: values.session as string };
}

export async function startTui(params?: { url?: string; sessionId?: string }): Promise<void> {
  const baseUrl = params?.url ?? "http://127.0.0.1:3100";
  const client = new TuiClient({
    url: baseUrl,
    sessionId: params?.sessionId ?? `tui-${Date.now()}`,
  });

  console.log(`\x1b[1m\x1b[36matom_neo\x1b[0m \x1b[2mchat\x1b[0m`);
  console.log(`\x1b[2msession:\x1b[0m ${client.sessionId}`);
  console.log(`\x1b[2mcore:\x1b[0m   ${baseUrl}`);
  console.log(`\x1b[2mconnecting...\x1b[0m`);

  await client.connect();

  console.log(`\x1b[2A\x1b[K\x1b[32mconnected\x1b[0m\n\x1b[2mtype /quit to exit\x1b[0m\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const ask = () => {
    rl.question(`\x1b[32m▸ \x1b[0m`, async (input) => {
      if (input === "/quit") { console.log(`\x1b[2mGoodbye!\x1b[0m`); rl.close(); process.exit(0); }
      if (!input.trim()) { ask(); return; }

      let started = false;
      client.onDelta((delta) => {
        if (!started) { process.stdout.write("\n"); started = true; }
        process.stdout.write(delta);
      });

      try {
        const fullText = await client.send(input);
        if (!started) {
          console.log(`\n${fullText}\n`);
        } else {
          console.log("\n");
        }
      } catch (err: any) {
        console.log(`\n\x1b[31mError: ${err.message}\x1b[0m\n`);
      }
      ask();
    });
  };

  ask();
}

async function main() {
  const args = parseTuiArgs(Bun.argv.slice(2));
  await startTui({ url: args.url, sessionId: args.sessionId });
}

if (import.meta.main) {
  main();
}
