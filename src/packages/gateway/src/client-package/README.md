# Gateway client packages

Manifest parsing and entry selection for Gateway clients. A client root contains a strict
`manifest.json`; package archives and directory installs are resolved to a command array that is
passed to `spawnProcess` without shell concatenation.

## Layout

| Path | Responsibility |
|------|----------------|
| `manifest.ts` | Manifest v1 schema, `parseManifest`, `resolveEntry` |
| `manifest.test.ts` | Schema, error, and entry-selection coverage |
| `resolver.ts` | User client config → `ResolvedClientConfig` (command/cwd/platform/env) |
| `resolver.test.ts` | Package/directory, credentials, error and package-root coverage |
| `integration.test.ts` | Fake-runtime package/directory startup, credentials and reserved args |
| `registry.ts` | `.atom/gateway/packages.json` read/write (G2) |
| `archive.ts` | tar.gz pack/install and path-escape checks (G2) |

`registry.ts` and `archive.ts` are planned for G2. `sandboxPackageRoot()` in `resolver.ts` is the temporary M1 package lookup and will be replaced by the registry.

## Manifest v1

- Strict: unknown top-level, `entry`, and config-field keys are rejected. Adding a field requires a
  new `manifest_version`.
- Required fields: `manifest_version` (exactly `1`), `id`, `name`, `version` (`major.minor.patch`),
  `platform`, and `entry`.
- Optional fields: `config`, `target`, `description`, `author`, `homepage_url`, `icons`.
- Secret config fields must declare `env`; a field `default` must belong to its `enum`.
- Unsupported `manifest_version` values fail before schema validation with a dedicated error.

## Entry selection

- `entry.production` is used for installed packages (`resolveEntry(manifest, "package")`).
- `entry.development` is used for source directories (`resolveEntry(manifest, "directory")`).
- There is no fallback. A missing selected entry throws
  `manifest.entry.production is required` or `manifest.entry.development is required`.
- The client root is the working directory; entries are non-empty string arrays and are passed
  through unchanged.
