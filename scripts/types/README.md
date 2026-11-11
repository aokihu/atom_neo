# Node typecheck shims

`tsconfig.node.json` keeps Bun-only modules out of the Node program without
weakening `types`:

| Module | Bun resolution | Node resolution |
|---|---|---|
| `./bun-http-server` (from `create-http-server.ts`) | real `bun-http-server.ts` | `bun-http-server.node.ts` via `moduleSuffixes: [".node", ""]` |
| `@opentui/react/runtime-plugin-support` | OpenTUI Bun plugin entry | `opentui-runtime-plugin-support.d.ts` via `paths` |

The shims declare the exact surface used by production code, not `any`.
`tsc --listFiles` confirms the Node program contains neither `bun-types` nor
the real Bun HTTP adapter. Bun typecheck/build still uses the real modules.

Keep these in sync if the Bun adapter or the OpenTUI plugin signature changes.
