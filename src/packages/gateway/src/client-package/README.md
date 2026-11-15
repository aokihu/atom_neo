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
| `registry.ts` | `.atom/gateway/packages.json` read/write under `packages.lock`, `sha256` idempotency/conflicts, reference checks, optional package-directory cleanup |
| `archive.ts` | tar.gz pack/install, target injection, path/link safety, commit/rollback |
| `source-index.ts` | Official source index v1 schema, file/http loading, version/target selection, archive hash/size entry generation |
| `download.ts` | Bounded/streamed artifact download with sha256 verification and failure cleanup |
| `source-install.ts` | Source index + download → existing `installClient`; cached version reuse |
| `instance-config.ts` | Offline package/directory instance configuration via shared `client-instance` |

`sandboxPackageRoot()` requires a registry record and rejects packages registered for another host target; there is no manual-directory fallback. `archive.test.ts` covers pack and install; the end-to-end round-trip lives in `src/bootstrap/gateway-package.e2e.test.ts`. Registry read-modify-write is serialized with `.atom/gateway/packages.lock` (bounded wait; stale locks are not auto-reclaimed).

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
  through unchanged. Entries must not define Gateway-reserved flags (`--secret`, `--port`,
  `--gateway-url`).
- `directory` may be absolute. Relative paths resolve against `ResolveOptions.baseDir`; Gateway
  bootstrap passes the sandbox root. The G2 CLI/wizard should persist absolute paths.
- Before launch, resolver enforces `manifest.config.required`: secret fields need a `credentials`
  reference, non-secret fields need the matching `clientArgs` key. Optional non-secret fields apply
  their manifest `default`; explicit `clientArgs` values must satisfy `enum`, and secret fields must
  not appear in `clientArgs`.
- Uninstall reference checks happen before package files are touched. With `removeFiles`, the
  package directory is renamed aside, the registry is written atomically, then the directory is
  deleted; registry write failure restores the directory. Credentials and development sources are
  never removed by package uninstall.
