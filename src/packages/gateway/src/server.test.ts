import { describe, expect, test } from "bun:test";
import { Logger } from "@atom-neo/shared";
import type { HttpServer } from "@atom-neo/shared";
import { startGateway } from "./server";

type ServedOptions = { port: number; host: string };

function fakeServer(port: number, stops: boolean[], onServe: (options: ServedOptions) => void): HttpServer {
  return {
    async serve(options) {
      onServe({ port: options.port, host: options.host });
      return {
        port,
        runtime: "node",
        async stop(force = false) {
          stops.push(force);
        },
      };
    },
  };
}

async function captureStdout(run: () => Promise<void>): Promise<string> {
  const writes: string[] = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: unknown) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    await run();
  } finally {
    process.stdout.write = originalWrite;
  }
  return writes.join("");
}

describe("startGateway", () => {
  test("serves through the injected HttpServer and logger, and stops both stages", async () => {
    const stops: boolean[] = [];
    let served: ServedOptions | undefined;
    let port = 0;

    const output = await captureStdout(async () => {
      const gateway = await startGateway({
        port: 0,
        clients: [],
        httpServer: fakeServer(4321, stops, options => {
          served = options;
        }),
        logger: new Logger("debug", () => {}),
      });
      port = gateway.port;
      await gateway.stop();
    });

    expect(port).toBe(4321);
    expect(served).toEqual({ port: 0, host: "127.0.0.1" });
    expect(stops).toEqual([false, true]);
    expect(output).not.toContain("gateway");
  });

  test("defaults to a silent logger without writing to stdout", async () => {
    const stops: boolean[] = [];
    let port = 0;

    const output = await captureStdout(async () => {
      const gateway = await startGateway({
        port: 0,
        clients: [],
        httpServer: fakeServer(4322, stops, () => {}),
      });
      port = gateway.port;
      await gateway.stop();
    });

    expect(port).toBe(4322);
    expect(output).not.toContain("gateway");
  });
});
