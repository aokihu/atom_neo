import { describe, expect, test } from "bun:test";
import { ManifestSchema, parseManifest, resolveEntry } from "./manifest";
import type { Manifest } from "./manifest";

const baseManifest = {
  manifest_version: 1,
  id: "telegram-bot",
  name: "Telegram Bot",
  version: "0.1.0",
  platform: "telegram",
  entry: {
    production: ["./bin/telegram-bot"],
    development: ["bun", "run", "src/main.ts"],
  },
} satisfies Manifest;

function manifestText(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...baseManifest, ...overrides });
}

describe("parseManifest", () => {
  test("parses a valid manifest with both entries", () => {
    const manifest = parseManifest(manifestText());

    expect(manifest).toEqual(baseManifest);
    expect(ManifestSchema.safeParse(manifest).success).toBe(true);
  });

  test("parses production-only and development-only manifests", () => {
    expect(parseManifest(manifestText({ entry: { production: ["./bin/bot"] } })).entry).toEqual({
      production: ["./bin/bot"],
    });
    expect(parseManifest(manifestText({ entry: { development: ["bun", "src/main.ts"] } })).entry).toEqual({
      development: ["bun", "src/main.ts"],
    });
  });

  test("rejects a manifest missing any of the six required fields", () => {
    for (const field of ["manifest_version", "id", "name", "version", "platform", "entry"]) {
      const value: Record<string, unknown> = { ...baseManifest };
      delete value[field];
      expect(() => parseManifest(JSON.stringify(value))).toThrow(field);
    }
  });

  test("rejects unknown and non-numeric manifest versions before schema validation", () => {
    expect(() => parseManifest(manifestText({ manifest_version: 2 }))).toThrow("Unsupported manifest_version: 2");
    expect(() => parseManifest(manifestText({ manifest_version: "1" }))).toThrow("Unsupported manifest_version");
  });

  test("rejects invalid JSON with a clear error", () => {
    expect(() => parseManifest("{ not json")).toThrow("Invalid manifest JSON");
  });

  test("rejects an entry object without production or development", () => {
    expect(() => parseManifest(manifestText({ entry: {} }))).toThrow(
      "manifest.entry requires production or development",
    );
  });

  test("rejects empty command arrays", () => {
    expect(() => parseManifest(manifestText({ entry: { production: [] } }))).toThrow(/entry\.production/);
  });

  test("rejects empty command strings", () => {
    expect(() => parseManifest(manifestText({ entry: { development: [""] } }))).toThrow(/entry\.development\.0/);
  });

  test("rejects unknown top-level fields", () => {
    expect(() => parseManifest(manifestText({ unexpected: true }))).toThrow('Unrecognized key: "unexpected"');
  });

  test("rejects unknown entry fields", () => {
    expect(() => parseManifest(manifestText({ entry: { production: ["bot"], staging: ["bot"] } }))).toThrow(
      'Unrecognized key: "staging"',
    );
  });

  test("rejects secret config fields without env", () => {
    expect(() =>
      parseManifest(manifestText({ config: { token: { label: "Token", type: "string", secret: true } } })),
    ).toThrow("manifest.config.env is required when secret is true");
  });

  test("rejects invalid config env names", () => {
    for (const env of ["BAD NAME", "A=B", ""]) {
      expect(() =>
        parseManifest(manifestText({ config: { token: { label: "Token", type: "string", secret: true, env } } })),
      ).toThrow(/env/);
    }
  });

  test("rejects a config default outside its enum", () => {
    expect(() =>
      parseManifest(
        manifestText({ config: { mode: { label: "Mode", type: "string", enum: ["longpoll"], default: "webhook" } } }),
      ),
    ).toThrow("manifest.config.default must be one of the enum values");
  });

  test("parses target and presentation fields with config defaults", () => {
    const manifest = parseManifest(
      manifestText({
        target: "darwin-arm64",
        description: "Telegram client",
        author: "Atom",
        homepage_url: "https://example.com/telegram-bot",
        icons: ["icon.png"],
        config: {
          "bot-token": { label: "Bot Token", type: "string", required: true, secret: true, env: "TELEGRAM_BOT_TOKEN" },
          mode: { label: "Mode", type: "string", enum: ["longpoll", "webhook"], default: "longpoll" },
        },
      }),
    );

    expect(manifest.target).toBe("darwin-arm64");
    expect(manifest.description).toBe("Telegram client");
    expect(manifest.author).toBe("Atom");
    expect(manifest.homepage_url).toBe("https://example.com/telegram-bot");
    expect(manifest.icons).toEqual(["icon.png"]);
    expect(manifest.config?.["bot-token"]).toEqual({
      label: "Bot Token",
      type: "string",
      required: true,
      secret: true,
      env: "TELEGRAM_BOT_TOKEN",
    });
    expect(manifest.config?.mode).toEqual({
      label: "Mode",
      type: "string",
      required: false,
      secret: false,
      enum: ["longpoll", "webhook"],
      default: "longpoll",
    });
  });

  test("rejects invalid version formats", () => {
    for (const version of ["1.0", "1.2.3.4", "v1.2.3", "1.2.x"]) {
      expect(() => parseManifest(manifestText({ version }))).toThrow("manifest.version must use major.minor.patch");
    }
  });
});

describe("resolveEntry", () => {
  const manifest: Manifest = parseManifest(manifestText());

  test("selects production for packages and development for directories", () => {
    expect(resolveEntry(manifest, "package")).toEqual(baseManifest.entry.production);
    expect(resolveEntry(manifest, "directory")).toEqual(baseManifest.entry.development);
  });

  test("does not fall back when the selected entry is missing", () => {
    const productionOnly = parseManifest(manifestText({ entry: { production: ["./bin/bot"] } }));
    expect(() => resolveEntry(productionOnly, "directory")).toThrow("manifest.entry.development is required");

    const developmentOnly = parseManifest(manifestText({ entry: { development: ["bun", "src/main.ts"] } }));
    expect(() => resolveEntry(developmentOnly, "package")).toThrow("manifest.entry.production is required");
  });
});
