import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHttpServer } from "./create-http-server";
import { resolveHttpRuntime } from "./detect";

const originalRuntime = process.env.ATOM_HTTP_RUNTIME;

beforeEach(() => {
  delete process.env.ATOM_HTTP_RUNTIME;
});

afterEach(() => {
  if (originalRuntime === undefined) delete process.env.ATOM_HTTP_RUNTIME;
  else process.env.ATOM_HTTP_RUNTIME = originalRuntime;
});

describe("resolveHttpRuntime", () => {
  test("accepts explicit bun and node", () => {
    expect(resolveHttpRuntime("bun")).toBe("bun");
    expect(resolveHttpRuntime("node")).toBe("node");
  });

  test("lets the explicit argument win over the environment", () => {
    process.env.ATOM_HTTP_RUNTIME = "node";
    expect(resolveHttpRuntime("bun")).toBe("bun");
    process.env.ATOM_HTTP_RUNTIME = "bun";
    expect(resolveHttpRuntime("node")).toBe("node");
  });

  test("falls back to the global runtime when the env is unset or empty", () => {
    // The bun:test process always has the Bun global.
    expect(resolveHttpRuntime()).toBe("bun");
    process.env.ATOM_HTTP_RUNTIME = "";
    expect(resolveHttpRuntime()).toBe("bun");
    expect(resolveHttpRuntime("")).toBe("bun");
  });

  test("fails fast on invalid env and explicit values", () => {
    process.env.ATOM_HTTP_RUNTIME = "wat";
    expect(() => resolveHttpRuntime()).toThrow(/ATOM_HTTP_RUNTIME.*bun.*node/);
    expect(resolveHttpRuntime("bun")).toBe("bun");
    expect(() => resolveHttpRuntime("wat")).toThrow(/HTTP runtime.*bun.*node/);
  });
});

describe("createHttpServer", () => {
  test("creates the Node adapter", async () => {
    const server = await createHttpServer("node");
    expect(typeof server.serve).toBe("function");
  });

  test("creates the Bun adapter", async () => {
    const server = await createHttpServer("bun");
    expect(typeof server.serve).toBe("function");
  });

  test("rejects an invalid runtime instead of defaulting", async () => {
    await expect(createHttpServer("invalid" as never)).rejects.toThrow(/"bun" \| "node"/);
  });
});
