import { afterEach, describe, expect, test } from "bun:test";
import { ClientConfigSchema } from "@atom-neo/shared";
import { loadGatewayConfig } from "./config";

const originalEnv = { GATEWAY_PORT: process.env.GATEWAY_PORT, CORE_URL: process.env.CORE_URL };
afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("loadGatewayConfig", () => {
  test("uses defaults", () => {
    delete process.env.GATEWAY_PORT;
    delete process.env.CORE_URL;
    expect(loadGatewayConfig()).toEqual({
      port: 3000,
      host: "127.0.0.1",
      coreUrl: "http://localhost:3100",
      clients: [],
      clientPortRangeStart: 4200,
    });
  });

  test("reads GATEWAY_PORT and CORE_URL from the environment", () => {
    process.env.GATEWAY_PORT = "4321";
    process.env.CORE_URL = "http://core:3100";
    const config = loadGatewayConfig();
    expect(config.port).toBe(4321);
    expect(config.coreUrl).toBe("http://core:3100");
  });

  test("ignores invalid env ports and lets overrides win", () => {
    process.env.GATEWAY_PORT = "nope";
    expect(loadGatewayConfig({ port: 5000 }).port).toBe(5000);
    process.env.GATEWAY_PORT = "70000";
    expect(loadGatewayConfig().port).toBe(3000);
  });

  test("validates clients with the shared client schema", () => {
    const config = loadGatewayConfig({
      clients: [{ id: "bot", platform: "telegram", binary: "./bot", stdio: "ignore" }],
    });
    expect(config.clients[0]).toEqual({ id: "bot", platform: "telegram", binary: "./bot", stdio: "ignore" });
    expect(() => ClientConfigSchema.parse(config.clients[0]!)).not.toThrow();
  });

  test("rejects duplicate client ids and invalid port ranges", () => {
    const client = { id: "bot", platform: "telegram", binary: "./bot", stdio: "inherit" as const };
    expect(() => loadGatewayConfig({ clients: [client, client] })).toThrow("unique");
    expect(() => loadGatewayConfig({ clientPortRangeStart: 65535, clients: [client, { ...client, id: "bot2" }] })).toThrow("port range");
  });
});
