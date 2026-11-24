// Child tools and platform clients must not inherit TUI management credentials
// or credentials that belong to other client instances.
import { describe, expect, test } from "bun:test";
import { createChildProcessEnv, INSTANCE_CREDENTIAL_PREFIX } from "./child-process-env";

describe("INSTANCE_CREDENTIAL_PREFIX", () => {
  test("namespaces persisted instance credentials", () => {
    expect(INSTANCE_CREDENTIAL_PREFIX).toBe("ATOM_CLIENT_");
  });
});

describe("createChildProcessEnv", () => {
  test("strips the admin token and every instance credential from the source", () => {
    const source = {
      PATH: "/bin",
      PLATFORM_KEY: "platform",
      ATOM_ADMIN_TOKEN: "private",
      ATOM_CLIENT_TELEGRAM_MAIN_BOT_TOKEN: "main",
      ATOM_CLIENT_TELEGRAM_OTHER_BOT_TOKEN: "other",
    };

    expect(createChildProcessEnv(source)).toEqual({ PATH: "/bin", PLATFORM_KEY: "platform" });
  });

  test("injects only the provided target instance values", () => {
    const source = { PATH: "/bin", ATOM_ADMIN_TOKEN: "private", ATOM_CLIENT_OTHER_KEY: "other" };

    expect(createChildProcessEnv(source, { TELEGRAM_BOT_TOKEN: "target" })).toEqual({
      PATH: "/bin",
      TELEGRAM_BOT_TOKEN: "target",
    });
  });

  test("filters dangerous keys out of the injected values", () => {
    const source = { PATH: "/bin" };

    expect(
      createChildProcessEnv(source, {
        TELEGRAM_BOT_TOKEN: "target",
        ATOM_ADMIN_TOKEN: "private",
        ATOM_CLIENT_OTHER_KEY: "other",
      }),
    ).toEqual({ PATH: "/bin", TELEGRAM_BOT_TOKEN: "target" });
  });

  test("lets injected values override unrelated source values", () => {
    expect(createChildProcessEnv({ PATH: "/bin", LOG_LEVEL: "info" }, { LOG_LEVEL: "debug" })).toEqual({
      PATH: "/bin",
      LOG_LEVEL: "debug",
    });
  });

  test("does not mutate the source or injected objects", () => {
    const source = { PATH: "/bin", ATOM_ADMIN_TOKEN: "private", ATOM_CLIENT_OTHER_KEY: "other" };
    const injected = { TELEGRAM_BOT_TOKEN: "target", ATOM_CLIENT_INJECTED_KEY: "injected" };

    createChildProcessEnv(source, injected);

    expect(source).toEqual({ PATH: "/bin", ATOM_ADMIN_TOKEN: "private", ATOM_CLIENT_OTHER_KEY: "other" });
    expect(injected).toEqual({ TELEGRAM_BOT_TOKEN: "target", ATOM_CLIENT_INJECTED_KEY: "injected" });
  });

  test("defaults to process.env and an empty injection", () => {
    const savedAdmin = process.env.ATOM_ADMIN_TOKEN;
    const savedCredential = process.env.ATOM_CLIENT_DEFAULT_TEST_KEY;
    const savedSentinel = process.env.ATOM_CHILD_ENV_SENTINEL;
    process.env.ATOM_ADMIN_TOKEN = "private";
    process.env.ATOM_CLIENT_DEFAULT_TEST_KEY = "other";
    process.env.ATOM_CHILD_ENV_SENTINEL = "kept";

    try {
      const env = createChildProcessEnv();
      expect(env.ATOM_ADMIN_TOKEN).toBeUndefined();
      expect(env.ATOM_CLIENT_DEFAULT_TEST_KEY).toBeUndefined();
      expect(env.ATOM_CHILD_ENV_SENTINEL).toBe("kept");
    } finally {
      for (const [key, value] of [
        ["ATOM_ADMIN_TOKEN", savedAdmin],
        ["ATOM_CLIENT_DEFAULT_TEST_KEY", savedCredential],
        ["ATOM_CHILD_ENV_SENTINEL", savedSentinel],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
