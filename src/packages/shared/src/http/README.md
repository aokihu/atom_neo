# HTTP runtime adapters

Transport contracts live in `types.ts`; `create-http-server.ts` selects an adapter
at runtime.

- `bun-http-server.ts`: Bun adapter (`Bun.serve` / `requestIP` / upgrade).
- `node-http-server.ts`: Node adapter (`node:http` + `ws`).
- `node-websocket-peer.ts`: narrows `ws` sockets to the `WebSocketPeer` contract.

`bun-http-server.ts` keeps its barrel export and is also loaded dynamically by
`create-http-server.ts`. `tsconfig.node.json` sets
`moduleSuffixes: [".node", ""]`, so the Node typecheck resolves
`./bun-http-server` (both the export and the dynamic import) to the exact shim
`bun-http-server.node.ts` and excludes the real adapter; Bun typecheck/build
still resolves `bun-http-server.ts`. Import the real file directly only from
Bun-only tests (`bun-http-server.test.ts`).
