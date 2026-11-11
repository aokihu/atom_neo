# Atom Neo Code Review Plan — S9 HTTP/WS Runtime — 2026-11-11

> 配套文件：
> - [code-review-s9-2026-11-11.md](./code-review-s9-2026-11-11.md)
> - [code-review-s9-graph-2026-11-11.md](./code-review-s9-graph-2026-11-11.md)
> - [code-review-plan-2026-11-10.md](./code-review-plan-2026-11-10.md)
>
> **Branch**: `code-review/2026-11-10`
> **Baseline**: `fc78eac` (v1.22.9)
> **状态**: S9-A/B 已实施；S9-C..E 待实施
> **目标**: Core/Gateway 在 Node 下正式启动，Bun 保持默认且行为不变

---

## 0. 决策记录

| 决策 | 结论 | 影响 |
|---|---|---|
| S9 是否一次完成 | **否**，拆为 S9-A..E | 每段可独立提交、验证、回滚 |
| Node 支持方式 | `HttpServer` 契约 + 适配器 | 业务层不再依赖 Bun |
| Bun 默认路径 | **不变** | 未设置环境变量时仍走 Bun adapter |
| Node 启用方式 | `ATOM_HTTP_RUNTIME=node` | S9 先可选启用，S10 再做发布 |
| `ws` 在 Bun 下是否可复用 | **spike 决定** | 通过则 S9-E 评估统一；失败则双实现 |
| 协议 | **不变** | HTTP 路由、状态码、WS 消息、Task/Event 契约不动 |
| 版本 | 子阶段不单独发版 | S9-E 完成后 `1.22.9 → 1.22.10` |
| 构建/CI | 不在 S9 | 留给 S10 |

### 版本基线

- Node：`>= 24`（本机 Node 26 已验证 `import.meta.main`、`node:sqlite`、`fs.glob`）。
- Bun：`>= 1.4`（本机 1.4.2）。
- `ws`：`^8.22.2`（Node adapter 使用；Bun 是否复用由 spike 决定）。
- `@types/ws`：`^8.18.2`（仅类型）。

---

## 1. 总体原则

1. **先契约，后实现**：S9-A 只定义类型和边界，不换传输。
2. **先 Bun，后 Node**：S9-B 用现有行为验证契约；S9-C 再接 Node。
3. **Bun 默认不变**：任何阶段都不能让未设置环境变量的 Bun 启动路径变化。
4. **适配器只做传输**：不把路由、鉴权、任务逻辑复制到 adapter。
5. **不做大爆炸**：不一次性删除 `Bun.serve`，不一次性迁移全部测试。
6. **协议零变更**：事件名、payload、状态码、admin header、Task 提交行为全部保持。
7. **禁区不动**：未实现 Element、Replay、PipelineRunner/Manager 本次不改。
8. **每段可回滚**：一个子阶段一个 commit；回滚不依赖后续阶段。

---

## 2. 阶段总览

| 阶段 | 主题 | 风险 | 预估 | 依赖 | 主要问题 |
|---|---|---|---|---|---|
| S9-A | 契约、类型与 spike | 低 | 1–1.5 天 | S8 | S9-RUN-02/03、S9-WS-01、S9-ADM-01 |
| S9-B | Bun Adapter | 中 | 1–2 天 | S9-A | S9-RUN-01/05、S9-WS-02、S9-GW-01 |
| S9-C | Node Adapter | 高 | 2–3 天 | S9-A/B | S9-RUN-04/05、S9-WS-03、S9-ADM-01 |
| S9-D | Node 入口与运行时选择 | 中–高 | 1–1.5 天 | S9-C | S9-ENTRY-01、S9-GW-02 |
| S9-E | 双运行时验收与清理 | 中 | 1–2 天 | S9-A..D | S9-TEST-01、S9-DOC-01 |

**总计**: 6–9 天（含 0.5 天 spike）。

### 顺序原则

```text
S9-A 契约/类型 + spike
  ↓
S9-B Bun Adapter（行为不变）
  ↓
S9-C Node Adapter（Node 可选）
  ↓
S9-D Node 入口（默认仍 Bun）
  ↓
S9-E 双运行时验收
```

- **不要先做 Node 入口**：否则同时调试入口、路由、WS、Request 桥接。
- **S9-B 不能省**：它是“契约不改变 Bun 行为”的证明，也是 Node 出问题时的回滚点。
- **S9-C 可以在 S9-B 后半段并行准备**：Node bridge/peer 可先写纯函数测试，但合并顺序仍在 B 后。
- **S9-E 不引入新功能**：只补测试、清残留、同步文档。

---

## 3. 阶段详情

### S9-A — 契约、类型与 spike（低）

**目标**：定义双运行时契约，把 Bun 类型从业务层移走；用 0.5 天 spike 决定 S9-E 的最终形态。

#### 3.1 Spike（先做）

**问题**：`node:http + ws` 能否在 Bun 下稳定复用？

**脚本**：`scripts/spike/ws-on-bun.ts`（临时脚本，不进入生产依赖）

```ts
import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const http = createServer((req, res) => {
  if (req.url === "/health") return res.writeHead(200).end("ok");
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ noServer: true });

http.on("upgrade", (req, socket, head) => {
  if (!req.url?.startsWith("/ws/")) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.send(JSON.stringify({ type: "session.ready", payload: { sessionId: "spike" } }));
    ws.on("message", (raw, isBinary) => {
      ws.send(JSON.stringify({ type: "echo", payload: { text: raw.toString(), isBinary } }));
    });
  });
});

http.listen(0, "127.0.0.1", () => {
  const address = http.address();
  console.log("ready", typeof address === "object" ? address?.port : address);
});

process.on("SIGTERM", () => {
  wss.clients.forEach(ws => ws.close(1001, "shutdown"));
  wss.close();
  http.close(() => process.exit(0));
});
```

**运行**:

```bash
bun scripts/spike/ws-on-bun.ts
# 另一终端用 ws 客户端连接 /ws/spike，验证 text / close
```

**通过标准**:

| 检查 | 通过条件 |
|---|---|
| Upgrade | 返回 101，`ws` 连接建立 |
| 文本帧 | 客户端发送 JSON，服务端收到并回显 |
| 二进制帧 | `isBinary=true` 可识别，不崩溃 |
| Close | 双方收到 close，code/reason 正确 |
| 进程退出 | `wss.close()` + `http.close()` 可完成，不挂起 |
| IP | `req.socket.remoteAddress` 为 `127.0.0.1` / `::1` / `::ffff:127.0.0.1` |
| 稳定性 | 连续 50 次连接/断开无泄漏 |

**决策**:

- **通过（方案 A 候选）**：S9-E 评估“统一 `node:http + ws`”，Bun adapter 保留为回滚路径至少一个版本。
- **失败（方案 B）**：保留 Bun adapter + Node adapter 双实现，`ATOM_HTTP_RUNTIME` 明确选择。
- 结论写入本文档 S9-A 实施记录与 `code-review-s9-2026-11-11.md` 变更记录。

#### 3.2 契约与类型

**新增**（仓库根 `src/` 下）：

```text
packages/shared/src/http/types.ts
packages/shared/src/http/detect.ts
packages/shared/src/http/index.ts
```

**类型**:

```ts
export type HttpRuntime = "bun" | "node";

export type HttpRequestContext = {
  readonly runtime: HttpRuntime;
  readonly ip: string;
  readonly port: number;
};

export type UpgradeDecision<TData = unknown> =
  | { data: TData }
  | { response: Response };

export type HttpRouter<TData = unknown> = {
  fetch(req: Request, ctx: HttpRequestContext): Promise<Response>;
  upgrade?(req: Request, ctx: HttpRequestContext): UpgradeDecision<TData> | undefined;
};

export type WebSocketPeer<TData = unknown> = {
  readonly data: TData;
  send(data: string): void;
  close(code?: number, reason?: string): void;
};

export type WebSocketHandlers<TData = unknown> = {
  open?(peer: WebSocketPeer<TData>): void;
  message?(peer: WebSocketPeer<TData>, data: string | Uint8Array): void;
  close?(peer: WebSocketPeer<TData>, code?: number, reason?: string): void;
  drain?(peer: WebSocketPeer<TData>): void;
};

export type HttpServerOptions<TData = unknown> = {
  port: number;
  host: string;
  fetch(req: Request, ctx: HttpRequestContext): Promise<Response>;
  upgrade?(req: Request, ctx: HttpRequestContext): UpgradeDecision<TData> | undefined;
  websocket?: WebSocketHandlers<TData>;
};

export type HttpServerHandle = {
  readonly port: number;
  readonly runtime: HttpRuntime;
  stop(force?: boolean): Promise<void>;
};

export interface HttpServer {
  serve<TData = unknown>(options: HttpServerOptions<TData>): Promise<HttpServerHandle>;
}
```

**运行时检测**:

```ts
export function resolveHttpRuntime(explicit?: string): HttpRuntime {
  const value = explicit ?? process.env.ATOM_HTTP_RUNTIME;
  if (value === "bun" || value === "node") return value;
  return typeof Bun !== "undefined" ? "bun" : "node";
}
```

#### 3.3 现有文件改造

| 文件 | 改动 |
|---|---|
| `src/packages/shared/src/utils/admin-auth.ts` | `isAdminRequest(req, ctx, token?, allowRemote?)`；使用 `ctx.ip` |
| `src/packages/core/src/http-router.ts` | 删除 `RouterServer`；`createHttpRouter` 返回 `{ fetch, upgrade }`；`requireAdmin(req, ctx, ...)` |
| `src/packages/core/src/ws/handler.ts` | `ServerWebSocket` → `WebSocketPeer<WsData>`；`message` 接收 `string \| Uint8Array` |
| `src/packages/core/src/ws/broadcaster.ts` | Map key 改为 `WebSocketPeer<WsData>` |
| `src/packages/core/src/server.ts` | 临时内联 Bun ctx（`ip/port`）与 upgrade 调用；**仍保留 `Bun.serve`** |
| `src/packages/gateway/src/server.ts` | admin 调用改为 `isAdminRequest(req, ctx, token)`；**暂不换传输** |

#### 3.4 测试

- 更新 `src/packages/core/src/http-router.test.ts`：ctx 形状、admin 403/200、upgrade 决策。
- 更新 `src/packages/core/src/ws/` 现有测试：peer 类型、消息解码。
- 新增 admin IP 测试：`127.0.0.1`、`::1`、`::ffff:127.0.0.1`、远端、空 IP。
- 不新增 Node 测试（S9-C 开始）。

#### 3.5 验收 / DoD

- [x] spike 结论落盘（通过/失败、版本、命令）。
- [x] `HttpServer` / `WebSocketPeer` / `HttpRequestContext` 类型可从 shared 导入。
- [x] `rg -n 'ServerWebSocket|from "bun"' src/packages/core/src/ws` 无结果。
- [x] `rg -n 'requestIP' src` 只在 Bun 临时 ctx（`server.ts`、`gateway/server.ts`）出现。
- [x] Bun 现有 HTTP/WS 行为不变；全量测试通过。
- [x] `bun run typecheck` / `bun test` / `bun run build` / docs 检查通过。

#### 3.6 风险 / 回滚

- **风险**: 路由签名改动导致所有 admin 路由临时 403；peer 类型改动导致 WS 编译错误。
- **回滚**: 单 commit revert；无新依赖，无传输变化。
- **注意**: 本阶段不新增 `ws` 依赖，不改 Gateway 传输。

#### 3.7 实施记录（2026-11-11）

**状态**: 已完成。

**Spike（通过，方案 A 候选）**:

- 版本：Bun 1.4.2（`bun --version`）、`ws` 8.22.2、Node 26.13.0（仅用于安装/对照）。
- 依赖：`ws@8.22.2` 只安装在 `mktemp -d` 临时目录，未写入仓库 `package.json` / `bun.lock`。
- 脚本：`scripts/spike/ws-on-bun.ts`（临时脚本，不进入生产路径）。
- 命令：

```bash
SPIKE_DIR=$(mktemp -d) && cd "$SPIKE_DIR"
npm init -y && npm install ws@8.22.2
NODE_PATH="$SPIKE_DIR/node_modules" bun /path/to/atom_neo/scripts/spike/ws-on-bun.ts
```

- 实际输出：

```text
[spike] listening on 127.0.0.1:56669
[spike] health 200 ok
[spike] upgrade 101
[spike] close code=1000 reason=spike-done text=true binary=true
[spike] connections completed 50/50
[spike] upgrade status 101
[spike] remoteAddress 127.0.0.1
[spike] closed cleanly
EXIT=0
```

- 结论：`node:http` + `ws` 在 Bun 下可完成 upgrade、文本/二进制帧、close、50 次连接/断开与干净退出；`req.socket.remoteAddress` 可用。S9-E 可按方案 A 评估统一实现，Bun adapter 仍保留为回滚路径。

**新增契约**:

- `src/packages/shared/src/http/types.ts`：`HttpRuntime` / `HttpRequestContext` / `UpgradeDecision` / `HttpRouter` / `WebSocketPeer` / `WebSocketHandlers` / `HttpServerOptions` / `HttpServerHandle` / `HttpServer`。
- `src/packages/shared/src/http/detect.ts`：`resolveHttpRuntime`（支持 `ATOM_HTTP_RUNTIME`，默认 Bun）。
- `src/packages/shared/src/http/index.ts` 与 shared 根导出。

**改造**:

- `isAdminRequest(req, { ip }, token?, allowRemote?)`；Core/Gateway 均改为传 ctx。
- 删除 `RouterServer`；`createHttpRouter` 返回 `{ fetch, upgrade }`；attach 端口取 `ctx.port`；无 Upgrade 的 `/ws/` 返回 400/426。
- WS handler/broadcaster 使用 `WebSocketPeer`；消息先归一再 `JSON.parse`。
- `server.ts` 仍在 Bun 边界内联构造 `HttpRequestContext`；`Bun.serve` 不变（仅对 `websocket` 做窄化类型断言）。

**验证**:

- `bun run typecheck`：6/6 通过。
- `bun test --path-ignore-patterns='**/dist/**'`：975 pass / 21 skip / 0 fail（基线 969 pass）。
- `bun test`：1729 pass / 21 skip / 0 fail（dist 重建后，含 dist 副本）。
- `bun run build`：6/6 通过。
- `bun run docs:check` / `bun run docs:typecheck`：通过。
- `rg -n 'ServerWebSocket|from "bun"' src/packages/core/src/ws`：无结果。
- `rg -n 'requestIP' src --glob '!**/dist/**'`：仅 `core/src/server.ts`、`gateway/src/server.ts`。

---

### S9-B — Bun Adapter（中）

**目标**：把现有 `Bun.serve` 包进 `HttpServer`，Core/Gateway 行为完全不变。

#### 4.1 新增文件

```text
packages/shared/src/http/bun-http-server.ts
packages/shared/src/http/create-http-server.ts
```

**Bun adapter 形状**:

```ts
export function createBunHttpServer(): HttpServer {
  return {
    async serve(options) {
      let server: Bun.Server<unknown> | undefined;
      server = Bun.serve({
        port: options.port,
        hostname: options.host,
        fetch(req, srv) {
          const ctx = {
            runtime: "bun" as const,
            ip: srv.requestIP(req)?.address ?? "",
            port: srv.port ?? options.port,
          };
          const decision = options.upgrade?.(req, ctx);
          if (decision && "response" in decision) return decision.response;
          if (decision) {
            const ok = srv.upgrade(req, { data: decision.data });
            return ok ? undefined : new Response("Upgrade Required", { status: 426 });
          }
          return options.fetch(req, ctx);
        },
        websocket: options.websocket,
      });
      let graceful: Promise<void> | null = null;
      let forced: Promise<void> | null = null;
      return {
        port: server.port ?? options.port,
        runtime: "bun",
        // graceful / force 分开缓存；force 可升级已发起的 graceful。
        stop(force = false) {
          if (force) return forced ??= (async () => { await graceful; server.stop(true); })();
          return graceful ??= (async () => { server.stop(false); })();
        },
      };
    },
  };
}
```

**工厂**:

```ts
export async function createHttpServer(runtime = resolveHttpRuntime()): Promise<HttpServer> {
  if (runtime === "bun") {
    const { createBunHttpServer } = await import("./bun-http-server");
    return createBunHttpServer();
  }
  const { createNodeHttpServer } = await import("./node-http-server");
  return createNodeHttpServer();
}
```

> S9-B 只实现 Bun 分支；`node-http-server.ts` 在 S9-C 补齐。工厂的 Node 分支可以先抛明确错误。

#### 4.2 改造

| 文件 | 改动 |
|---|---|
| `src/packages/core/src/server.ts` | 删除 `Bun.serve` / `Bun.Server`；`startCore` 接受可选 `httpServer`，默认 `createHttpServer()`；用 `handle.stop(false/true)` |
| `src/packages/gateway/src/server.ts` | 删除 `Bun.serve`；使用 `HttpServer`；`startGateway` 接受可选 `httpServer` |
| `src/packages/core/src/http-router.ts` | 保持 S9-A 的 `{ fetch, upgrade }` 形状 |
| `src/bootstrap/fixtures/gateway-client.ts` | 暂不动；S9-E 再清 |

**Core 目标结构**:

```ts
export async function startCore(deps: CoreDeps & { httpServer?: HttpServer }): Promise<CoreHandle> {
  const httpServer = deps.httpServer ?? await createHttpServer();
  // ... bootstrap / router ...
  let handle: HttpServerHandle | undefined;
  try {
    handle = await httpServer.serve({
      port,
      host,
      fetch: router.fetch,
      upgrade: router.upgrade,
      websocket: core.wsHandlers,
    });
  } catch (error) {
    await stop();
    throw error;
  }
  // ...
}
```

#### 4.3 测试

- 新增 `packages/shared/src/http/bun-http-server.test.ts`：
  - `port: 0` 返回真实端口。
  - `fetch` 200 / 404。
  - upgrade 决策：合法 sid → 101；非法 sid → 400；无 Upgrade → 426。
  - `stop(false)` 后不再接受新连接。
  - `stop(true)` 关闭 WS 客户端。
- 现有 `server.test.ts`、`http-router.test.ts`、`server-continuation.test.ts` 全部通过。
- Gateway 启停测试通过。

#### 4.4 验收 / DoD

- [x] `rg -n 'Bun\.serve|Bun\.Server' src --glob '!**/dist/**'` 只匹配 Bun adapter（fixture 除外，S9-E 清）。
- [x] Core/Gateway 均通过 `HttpServer` 启动/停止。
- [x] HTTP 路由、状态码、WS 消息、admin 行为与 `fc78eac` 一致。
- [x] 全量测试、build、docs 检查通过。
- [x] Bun 默认启动路径不变。

#### 4.5 风险 / 回滚

- **风险**: Bun `srv.upgrade` 必须在 fetch 同步调用；工厂/路由改成异步后可能丢失 upgrade 窗口。
- **风险**: `stop(false)` 的 Bun 语义与 Node 不同，先把 Core 的两阶段顺序保持不变。
- **回滚**: 删除 adapter，`server.ts` 恢复内联 `Bun.serve`；单 commit revert。
- **注意**: 不在此阶段改 Gateway logger（S9-D）。

#### 4.6 实施记录（2026-11-11）

**状态**: 已完成。

**新增**:

- `src/packages/shared/src/http/bun-http-server.ts`：`createBunHttpServer(): HttpServer`；`Bun.serve`、`requestIP`、upgrade 与两阶段 stop 全部收敛在该文件；WebSocket handler 只在边界做窄化类型断言，不包装 peer。
- `src/packages/shared/src/http/create-http-server.ts`：`createHttpServer(runtime)`；Bun 分支动态加载 adapter，Node 分支暂抛 `Node HTTP runtime is not available until S9-C`。
- `src/packages/shared/src/http/bun-http-server.test.ts`：5 个契约测试（`port: 0` / ctx、200/404、upgrade 101/400/426、`stop(false)`、`stop(true)`）。

**改造**:

- `src/packages/shared/src/http/index.ts`、`src/packages/shared/src/index.ts`：导出 `createHttpServer` / `createBunHttpServer`。
- `src/packages/core/src/server.ts`：`startCore` 接受可选 `httpServer`，默认工厂；删除 `Bun.serve` / `Bun.Server` / 内联 ctx / 内联 upgrade；stop 顺序保持 `handle.stop(false)` → shutdown → `await handle.stop(true)`。
- `src/packages/gateway/src/server.ts`：`GatewayOverrides` 接受可选 `httpServer`；删除 `Bun.serve`；admin 使用 `ctx.ip`；start/stop 与失败回滚顺序不变。

**stop 语义**:

- `stop(false)`：调用 `server.stop(false)` 后立即 resolve，不等长连接/WS。
- `stop(true)`：先等待已发起的 graceful，再 `await server.stop(true)`；重复调用复用同一 Promise，force 可升级 graceful。

**验证**:

- `bun run typecheck`：6/6。
- `bun test --path-ignore-patterns='**/dist/**'`：980 pass / 21 skip / 0 fail（基线 975）。
- `bun test`：1734 pass / 21 skip / 0 fail（build 前）；dist 重建后 1739 pass / 21 skip / 0 fail。
- `bun run build`：6/6。
- `bun run docs:check` / `bun run docs:typecheck`：通过。
- `rg -n 'Bun\.serve|Bun\.Server' src --glob '!**/dist/**' --glob '!**/*.test.ts'`：仅 `src/packages/shared/src/http/bun-http-server.ts` 与 fixture `src/bootstrap/fixtures/gateway-client.ts`（S9-E 清理）。
- `rg -n 'requestIP' src --glob '!**/dist/**' --glob '!**/*.test.ts'`：仅 `src/packages/shared/src/http/bun-http-server.ts`。

---

### S9-C — Node Adapter（高）

**目标**：新增 `node:http` + `ws` 实现；Node 可选启用，Bun 默认不变。

#### 5.1 依赖

在 `src/packages/shared/package.json`：

```json
{
  "dependencies": {
    "ws": "^8.22.2"
  },
  "devDependencies": {
    "@types/ws": "^8.18.2"
  }
}
```

> `ws` 只在 Node adapter 中动态 import；TUI 不加载服务端实现。

#### 5.2 新增文件

```text
packages/shared/src/http/node-http-server.ts
packages/shared/src/http/node-websocket-peer.ts
scripts/node-smoke/http-runtime.ts
```

#### 5.3 HTTP 桥接

**Request**:

```ts
function toWebRequest(req: IncomingMessage, port: number): Request {
  const host = req.headers.host ?? `127.0.0.1:${port}`;
  const url = new URL(req.url ?? "/", `http://${host}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) headers.append(key, item);
  }
  const method = req.method ?? "GET";
  const body = method === "GET" || method === "HEAD"
    ? undefined
    : Readable.toWeb(req) as unknown as ReadableStream<Uint8Array>;
  return new Request(url, {
    method,
    headers,
    body,
    duplex: "half",
    signal: abortSignalFor(req),
  } as RequestInit);
}
```

**Response**:

```ts
async function writeWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  for (const [key, value] of response.headers) {
    if (key.toLowerCase() === "set-cookie") continue;
    res.setHeader(key, value);
  }
  const cookies = response.headers.getSetCookie?.() ?? [];
  if (cookies.length > 0) res.setHeader("set-cookie", cookies);

  if (response.status === 204 || response.status === 304 || !response.body) {
    res.end();
    return;
  }
  await pipeline(Readable.fromWeb(response.body as any), res);
}
```

**服务器**:

```ts
const server = createServer(async (req, res) => {
  const ctx = { runtime: "node" as const, ip: remoteIp(req), port };
  try {
    const response = await options.fetch(toWebRequest(req, port), ctx);
    await writeWebResponse(res, response);
  } catch (error) {
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Internal error" }));
  }
});
```

> `port=0` 时必须在 `listen` 回调中读取 `server.address()` 的真实端口并更新 `ctx.port`，否则 attach 返回 0。

#### 5.4 WebSocket 桥接

```ts
const wss = new WebSocketServer({ noServer: true });
const peers = new WeakMap<WebSocket, WebSocketPeer<unknown>>();

function peerFor(socket: WebSocket, data: unknown): WebSocketPeer<unknown> {
  let peer = peers.get(socket);
  if (!peer) {
    peer = {
      data,
      send: (payload) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(payload);
      },
      close: (code, reason) => socket.close(code, reason),
    };
    peers.set(socket, peer);
  }
  return peer;
}

server.on("upgrade", (req, socket, head) => {
  const request = toWebRequest(req, port);
  const ctx = { runtime: "node" as const, ip: remoteIp(req), port };
  const decision = options.upgrade?.(request, ctx);
  if (!decision) return rejectUpgrade(socket, 404);
  if ("response" in decision) return writeResponseToSocket(socket, decision.response);
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req, decision.data);
  });
});

wss.on("connection", (socket, _req, data) => {
  const peer = peerFor(socket, data);
  handlers.open?.(peer);
  socket.on("message", (raw, isBinary) => {
    const payload = isBinary
      ? new Uint8Array(Array.isArray(raw) ? Buffer.concat(raw) : raw as ArrayBuffer)
      : (Array.isArray(raw) ? Buffer.concat(raw) : raw).toString();
    handlers.message?.(peer, payload);
  });
  socket.on("close", (code, reason) => handlers.close?.(peer, code, reason.toString()));
  socket.on("error", () => { handlers.close?.(peer); socket.terminate(); });
  socket.on("drain", () => handlers.drain?.(peer));
});
```

**关键点**:

- `peer` 必须按 socket 缓存；`open` / `message` / `close` 同一引用。
- `close` 与 `error` 都清理；handler 的 `close` 必须幂等。
- `isBinary=true` 交给 handler 解析失败 → `control.error`，不崩溃。
- `socket.readyState === OPEN` 才 `send`。

#### 5.5 关闭 / drain

```ts
let graceful: Promise<void> | null = null;
let forced: Promise<void> | null = null;

function stop(force = false): Promise<void> {
  if (force) return forced ??= (async () => {
    await graceful;
    for (const socket of wss.clients) socket.close(1001, "server shutdown");
    server.closeAllConnections?.();
    await Promise.all([closeWss(wss), closeServer(server)]);
  })();
  return graceful ??= (async () => {
    server.close();                 // 停止 listen，不等长连接
    server.closeIdleConnections?.();
  })();
}
```

**语义**:

- `force=false`：停止 listen，关闭空闲 keep-alive；resolve 不等长连接/WS。
- `force=true`：关闭 WS + active sockets；等待 `wss.close` 与 `server.close`。
- 重复调用返回同一 Promise。

#### 5.6 测试 / smoke

`scripts/node-smoke/http-runtime.ts`（用 Node 运行）：

```bash
# 先构建或使用可执行的 Node 入口（S9-D 后）
ATOM_HTTP_RUNTIME=node node scripts/node-smoke/http-runtime.ts
```

覆盖：

| 场景 | 断言 |
|---|---|
| `GET /api/health` | 200，`status` 字段存在 |
| `POST /api/tui/attach` | 200，`sessionId` / `serverInfo` |
| admin 403/200 | 错误 token 403；loopback + 正确 token 200 |
| `POST /api/tasks` | 创建任务，fake model 完成 |
| `GET /api/tasks/:id` | 状态到 completed |
| WS `session.ready` | 连接后收到 |
| WS `control.ping` | 收到 `control.pong` |
| WS `task.submit` | 收到 `task.created` |
| 断开 | 无未捕获异常，broadcaster 清理 |
| `stop(false)` → `stop(true)` | 进程退出，无挂起 |

#### 5.7 验收 / DoD

- [ ] `node:http` + `ws` 在 Node 下完成 Core 启动、health、attach、task、WS、stop。
- [ ] admin IP 在 Node 下正确（loopback 允许，远端拒绝）。
- [ ] Bun 路径测试全部通过，默认不变。
- [ ] Node 适配器错误路径不泄漏 socket/timer。
- [ ] `rg -n 'ServerWebSocket|requestIP' src --glob '!**/dist/**'` 只在 Bun adapter。
- [ ] `bun install` 更新 lockfile，`ws`/`@types/ws` 进入 shared。
- [ ] 全量测试、build、docs 检查通过。

#### 5.8 风险 / 回滚

- **风险**: Node `server.close()` 等待所有连接 → 关闭挂起。
- **风险**: `Request` body 的 `duplex: "half"` 缺失 → POST 直接抛错。
- **风险**: `ws` 的 `RawData` 为 `Buffer[]` → `toString()` 错误。
- **风险**: `peer` 每次新建 → broadcaster 泄漏。
- **回滚**: 删除 Node adapter、`ws` 依赖与工厂 Node 分支；Bun adapter 不受影响。
- **注意**: 不在本阶段切默认入口。

---

### S9-D — Node 入口与运行时选择（中–高）

**目标**：让 Node 正式启动；Bun 默认路径不变；Gateway 日志可注入。

#### 6.1 入口

| 文件 | 改动 |
|---|---|
| `src/main.ts` | `resolveHttpRuntime()`；创建 `HttpServer` 并传给 `startCore` / `startGateway`；兼容 `import.meta.main` |
| `src/packages/core/src/server.ts` | `startCore` 接受 `httpServer?`；默认工厂 |
| `src/packages/gateway/src/server.ts` | `startGateway` 接受 `logger?` / `httpServer?`；删除模块级 logger |
| `packages/shared/src/http/detect.ts` | 环境变量解析与错误信息 |
| `packages/shared/src/http/create-http-server.ts` | Bun/Node 分支；明确失败信息 |

**入口目标**:

```ts
import { fileURLToPath } from "node:url";

const metaMain = (import.meta as ImportMeta & { main?: boolean }).main;
const isMain = metaMain ?? process.argv[1] === fileURLToPath(import.meta.url);

const runtime = resolveHttpRuntime();
const httpServer = await createHttpServer(runtime);

// core
const core = await startCore({ ...args, httpServer });

// gateway
const gateway = await startGateway({
  ...gatewayOptions,
  logger,
  httpServer,
});
```

> `HttpServer` 是“可多次 `serve` 的工厂”：Core 与 Gateway 可以共用同一个实例，各自 `serve` 不同端口。适配器内部不得持有单例 server 状态。
>
> `import.meta.main` 在 Node 24.2+ 可用；24.0/24.1 走 `argv[1]` fallback。Bun 编译二进制仍由 `import.meta.main` 判定，S10 再固化打包入口。

**运行时规则**:

| 条件 | 行为 |
|---|---|
| 未设置 `ATOM_HTTP_RUNTIME`，有 `Bun` | Bun adapter（默认） |
| 未设置，无 `Bun` | Node adapter |
| `=bun`，Node 环境 | 启动失败，错误信息说明缺少 Bun |
| `=node`，Bun 环境 | 仅当 spike 通过允许；否则失败并提示 |
| 其他值 | 启动失败，列出允许值 |

#### 6.2 Gateway logger

```ts
// 目标
export type GatewayOverrides = Partial<GatewayConfig> & {
  adminToken?: string;
  logger?: Logger;
  httpServer?: HttpServer;
};

export async function startGateway(overrides?: GatewayOverrides) {
  const logger = overrides?.logger ?? createDefaultLogger();
  // ...
}
```

- 删除 `logHub` / `StdoutSink` / `Logger` 的模块级初始化。
- `if (import.meta.main)` 分支才创建默认 logger。
- `main.ts` 传入自己的 logger，`--log*` 对 Gateway 生效。

#### 6.3 测试

- 运行时选择单测：环境变量、`Bun` 全局存在/不存在、非法值。
- Gateway logger 注入测试：silent logger 无 stdout。
- Node 入口 smoke：`ATOM_HTTP_RUNTIME=node` 启动 Core，health/attach/task/WS。
- Bun 默认 smoke：不设环境变量，确认仍走 Bun adapter。
- `import.meta.main` 兼容测试：Bun + Node 入口判断。

#### 6.4 验收 / DoD

- [ ] Bun 默认启动不变（模式、端口、attach、TUI）。
- [ ] `ATOM_HTTP_RUNTIME=node` 下 Core 可启动并完成 smoke。
- [ ] Gateway 日志注入生效，import 无副作用。
- [ ] 非法运行时值 fail-fast，错误信息明确。
- [ ] 全量测试、build、docs 检查通过。
- [ ] 文档更新：`bootstrap.md`、`gateway.md`、`project-structure.md`。

#### 6.5 风险 / 回滚

- **风险**: `main.ts` 提前创建 adapter，影响首次向导/配置分支；必须只在 Core/Gateway 分支创建。
- **风险**: Node 下 `import.meta.main` 类型/运行差异；用兼容访问，不改变入口行为。
- **风险**: Gateway logger 改为必填导致测试/调用点遗漏；保留显式默认但只在入口创建。
- **回滚**: 删除环境变量分支与 `httpServer` 注入，恢复 `startCore`/`startGateway` 内部创建 Bun 传输。
- **注意**: 不改变 `--mode` 分流、TUI attach、首启向导。

---

### S9-E — 双运行时验收与清理（中）

**目标**：同一组 HTTP/WS 场景在 Bun/Node 下通过；清理残留；同步文档；决定方案 A/B 的最终形态。

#### 7.1 双运行时契约测试

- Bun：`bun:test`（现有 + 新增）。
- Node：`scripts/node-smoke/http-runtime.ts`（`node:assert/strict` + `fetch` + `ws`）。
- 共用场景表（见 S9-C 5.6），断言口径一致。
- 增加跨运行时场景：
  - Bun TUI attach 到 Node Core。
  - Node Core + Bun Gateway（如果 Gateway 在 Node 下可用）。
  - Node Core 重启后 TUI 重连（sessionId 不变）。

#### 7.2 清理

| 项 | 处理 |
|---|---|
| `src/bootstrap/fixtures/gateway-client.ts` | 改用 `node:http` 或 `HttpServer`，移除 `Bun.serve` |
| `ServerWebSocket` | 只允许 Bun adapter 内部类型；业务层无引用 |
| `requestIP` | 只允许 Bun adapter |
| `Bun.Server` | 只允许 Bun adapter |
| 临时 spike 脚本 | 保留为 `scripts/spike/` 或删除；不进入生产路径 |
| 临时 `Response \| undefined` | 删除；fetch 必须返回 `Response` |

**残留检查**:

```bash
rg -n 'Bun\.serve|Bun\.Server' src --glob '!**/dist/**' --glob '!**/node_modules/**' --glob '!**/*.test.ts'
# 期望：仅 bun-http-server.ts

rg -n 'ServerWebSocket|from "bun"' src --glob '!**/dist/**' --glob '!**/node_modules/**' --glob '!**/*.test.ts'
# 期望：仅 bun-http-server.ts（或 0）

rg -n 'requestIP' src --glob '!**/dist/**' --glob '!**/node_modules/**' --glob '!**/*.test.ts'
# 期望：仅 bun-http-server.ts

rg -n 'isAdminRequest\(' src --glob '!**/dist/**' --glob '!**/*.test.ts'
# 期望：core/gateway 均传 ctx，不传 server
```

#### 7.3 方案 A/B 决策

| spike 结果 | S9-E 动作 |
|---|---|
| 通过 | 评估删除 Bun adapter，统一 `node:http + ws`；至少保留一个版本作为回滚开关 |
| 失败 | 保留双 adapter；文档明确 `ATOM_HTTP_RUNTIME` 与默认值 |

**不强制删除 Bun adapter**：如果统一实现的性能、行为、测试都稳定，再在 S10 或后续版本删除；S9 以“可回滚”为优先。

#### 7.4 文档

| 文档 | 更新 |
|---|---|
| `docs/overview/bootstrap.md` | 运行时选择、两阶段 stop、Node smoke |
| `docs/communication/gateway.md` | `HttpServer`、无 WS、logger 注入 |
| `docs/communication/protocol.md` | 传输层无关声明；消息/路由/状态码不变 |
| `docs/overview/project-structure.md` | `shared/src/http` 模块、`ws` 依赖 |
| `docs/index.md` | 三份 S9 文档入口 |
| `docs/overview/development-setup.md` | Node smoke 命令（如稳定） |

#### 7.5 验收 / DoD

- [ ] Bun 全量测试通过（源码 + dist）。
- [ ] Node smoke 全场景通过。
- [ ] 跨运行时 attach / WS 通过。
- [ ] 残留检查符合预期。
- [ ] 文档同步，`docs:check` / `docs:typecheck` 通过。
- [ ] 版本 `1.22.9 → 1.22.10`。
- [ ] 形成 S10 handoff：Node 构建入口、CI 命令、`@opentui/*` external 清单。

#### 7.6 风险 / 回滚

- **风险**: Node smoke 依赖未构建的源码，测试不稳定；固定用 `bun build --target node` 产物或 S9-D 的可执行入口。
- **风险**: 跨运行时 attach 暴露 IP/端口问题；先测 loopback。
- **风险**: 清理 `Bun.serve` 时误删 Bun 回滚路径；保留 adapter 直到 S10。
- **回滚**: S9-E 只改测试/文档/清理，不影响运行时；可单独 revert。

---

## 4. 兼容矩阵

| 契约 | 当前 | S9 目标 | 验证 |
|---|---|---|---|
| Core HTTP 路由 | 路径/方法/优先级 | 完全不变 | `http-router.test.ts` + 手工 |
| HTTP 状态码 | 200/201/400/403/404/409/500/503 | 完全不变 | 路由逐条 |
| attach 响应 | `sessionId` + `serverInfo` | 字段不变；`port` 为真实端口 | attach 测试 |
| admin header | `x-atom-admin-token` | 不变 | 403/200 |
| admin IP | `requestIP` | `ctx.ip` | loopback/远端 |
| WS 路径 | `/ws/:sessionId` | 不变 | upgrade 测试 |
| WS 消息 | `EVENTS` / `WsMessages` | 字符串/payload/envelope 不变 | 协议测试 |
| WS 顺序 | `session.ready` 先于任务事件 | 不变 | WS 测试 |
| Task 提交 | `TaskSubmissionService` | 不变 | task 测试 |
| Gateway 路由 | `/admin/clients`、`/gateway/*` | 不变 | Gateway 测试 |
| Gateway 鉴权 | secret + admin token | 不变 | 401/403/429 |
| 关闭顺序 | WS → timers → hooks → drain → checkpoint → MCP → server | 不变 | 关停测试 |
| Bun 默认 | `Bun.serve` | Bun adapter | 不设环境变量 |
| Node | 不可用 | Node adapter，可选 | `ATOM_HTTP_RUNTIME=node` |

---

## 5. 测试矩阵

| 场景 | S9-A | S9-B | S9-C | S9-D | S9-E |
|---|---|---|---|---|---|
| 契约类型编译 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 路由 403/200 | ✅ | ✅ | ✅ | ✅ | ✅ |
| upgrade 决策 | ✅ | ✅ | ✅ | ✅ | ✅ |
| Bun WS 协议 | ✅ | ✅ | ✅ | ✅ | ✅ |
| Bun 启停 | — | ✅ | ✅ | ✅ | ✅ |
| Node HTTP | — | — | ✅ | ✅ | ✅ |
| Node WS | — | — | ✅ | ✅ | ✅ |
| Node admin IP | — | — | ✅ | ✅ | ✅ |
| Node 入口 | — | — | — | ✅ | ✅ |
| 双运行时同场景 | — | — | — | — | ✅ |
| 跨运行时 attach | — | — | — | — | ✅ |
| 残留检查 | 部分 | 部分 | ✅ | ✅ | ✅ |

---

## 6. 风险与回滚矩阵

| 阶段 | 主要风险 | 回滚方式 | 备注 |
|---|---|---|---|
| S9-A | admin 签名改动导致 403；WS 类型编译错误 | revert 单 commit | 无新依赖 |
| S9-B | Bun upgrade 窗口；stop 语义 | 恢复 `server.ts` 内联 `Bun.serve` | 行为回滚点 |
| S9-C | Node body 挂起；close 挂起；peer 泄漏；`ws` 帧形态 | 删除 Node adapter + `ws` 依赖 | 依赖回滚点 |
| S9-D | 入口分叉影响 TUI/向导；Gateway logger 遗漏 | 删除环境变量分支 + logger 注入 | 入口回滚点 |
| S9-E | smoke 不稳定；清理误删回滚路径 | 只回退测试/文档/清理 | 不影响运行时 |

### 重点风险

1. **admin 403 锁死 TUI**：所有 admin 路由在 S9-A 后必须用 `ctx.ip`；先跑 loopback 测试，再改 Gateway。
2. **Node `server.close()` 挂起**：`stop(false)` 不能 await 长连接；用 `closeIdleConnections` + 立即 resolve，`stop(true)` 再 `closeAllConnections`。
3. **Node POST body 挂起**：`Readable.toWeb(req)` + `duplex: "half"`；空 body 与 chunked 都要测。
4. **WS peer 身份不一致**：Node 用 `WeakMap<WebSocket, Peer>`；`open`/`message`/`close` 同一对象。
5. **`RawData` 形态**：Node `ws` 可能是 `Buffer[]`/`ArrayBuffer`；先归一再 `JSON.parse`。
6. **204/304/HEAD**：不写 body；`Set-Cookie` 多值用 `getSetCookie()`。
7. **Bun 默认回归**：每个阶段都跑一次不设环境变量的 Bun smoke。
8. **`ws` on Bun spike 失败**：不阻塞 S9-C，按方案 B 双实现；S9-E 不做统一。
9. **`@types/bun` 泄漏**：S10 才拆 `tsconfig`；S9 只保证业务层不 import `bun`。
10. **Gateway logger**：import 无副作用；默认 logger 只在入口创建。

---

## 7. 依赖与并行

```text
S9-A ──→ S9-B ──→ S9-C ──→ S9-D ──→ S9-E ──→ S10
          │          │
          │          └─ Node bridge/peer 可提前写纯函数测试
          └─ Bun adapter 是行为回滚点
```

- **必须串行**: A → B → C → D → E。
- **可并行准备**:
  - S9-B 进行时，可先写 Node `toWebRequest` / `writeWebResponse` 的纯函数测试（不合并）。
  - S9-C 进行时，可先写双运行时 smoke 场景表（S9-E 合并）。
  - S9-D 文档可在 C 通过后开始。
- **S10 依赖 S9-E**：Node 构建/CI 不能在 S9 完成前切默认。

---

## 8. 子阶段 Definition of Done

每个子阶段都必须满足：

- [ ] 源码改动与测试同 commit。
- [ ] `bun run typecheck` 6/6。
- [ ] `bun test --path-ignore-patterns='**/dist/**'` 0 fail。
- [ ] `bun test` 0 fail（允许既有 dist 副本）。
- [ ] `bun run build` 6/6。
- [ ] `bun run docs:check` / `bun run docs:typecheck` 通过（涉及文档时）。
- [ ] 本阶段验收项全部勾选。
- [ ] 更新 `docs/code-review-2026-11-10/code-review-plan-2026-11-10.md` 进度表。
- [ ] 记录基线/最终测试数与已知遗留。
- [ ] 不提交 `sandbox/config.json`、`.atom/`、`hooks.json`、`schedule-tasks.json`。
- [ ] 不修改禁区代码。

### Commit 建议

```text
refactor: add HTTP/WS runtime contracts (S9-A)
refactor: wrap Bun server behind HttpServer (S9-B)
feat: add Node HTTP/WS adapter (S9-C)
feat: add Node runtime entry (S9-D)
test: add dual-runtime HTTP/WS smoke (S9-E)
```

### 版本

- S9-A..D 不单独升级版本号，避免中间态发布号。
- S9-E 完成后统一 `1.22.9 → 1.22.10`，并更新 `src/version.ts`、`package.json`、项目结构文档。

---

## 9. 验收命令汇总

```bash
# 类型
bun run typecheck

# 源码测试
bun test --path-ignore-patterns='**/dist/**'

# 全量测试
bun test

# 构建
bun run build

# 文档
bun run docs:check
bun run docs:typecheck

# Bun 默认路径
bun run src/main.ts --mode core --port 0 --sandbox ./sandbox

# Node 路径（S9-D 后）
ATOM_HTTP_RUNTIME=node node dist/node/main.js --mode core --port 0 --sandbox ./sandbox

# Node smoke（S9-C/E）
ATOM_HTTP_RUNTIME=node node scripts/node-smoke/http-runtime.ts

# 残留检查（S9-E）
rg -n 'Bun\.serve|Bun\.Server' src --glob '!**/dist/**' --glob '!**/node_modules/**' --glob '!**/*.test.ts'
rg -n 'ServerWebSocket|from "bun"' src --glob '!**/dist/**' --glob '!**/node_modules/**' --glob '!**/*.test.ts'
rg -n 'requestIP' src --glob '!**/dist/**' --glob '!**/node_modules/**' --glob '!**/*.test.ts'
```

---

## 10. 暂不做 / S10 Handoff

### S9 暂不做

- Node 发布包、`dist/node`、`package.json#exports`。
- `tsconfig.node.json` / 去掉 `@types/bun`。
- CI Node 24/26 矩阵。
- TUI 在 Node 下的完整启动/渲染验证。
- 删除 Bun adapter（除非 S9-E 证明统一实现完全稳定，且保留回滚开关）。
- 全量 `bun:test` 迁移到 Node。

### S10 输入

- `HttpServer` / `WebSocketPeer` 契约与两个 adapter。
- Node smoke 场景与命令。
- 已知限制：`ws` 在 Bun 下的 spike 结论、Node 关闭语义、admin IP 规则。
- 需要 external 的依赖：`@opentui/core`、`@opentui/react`、`ws`（如打包）。
- 构建入口：`src/main.ts` 的运行时选择。

---

## 11. 进度追踪

| 阶段 | 状态 | Commit | 备注 |
|---|---|---|---|
| S9-A | 已完成 | — | 契约/类型 + spike；shared `http` 契约、admin `ctx.ip`、router `fetch`/`upgrade`、WS `WebSocketPeer`；`ws` on Bun spike 通过；源码 975 pass / 21 skip / 0 fail |
| S9-B | 已完成 | — | Bun adapter：`createBunHttpServer` / `createHttpServer`；Core/Gateway 改由 `HttpServer` 启停；源码 980 pass / 21 skip / 0 fail，全量（build 后）1739 pass |
| S9-C | 未开始 | — | Node adapter |
| S9-D | 未开始 | — | Node 入口 |
| S9-E | 未开始 | — | 双运行时验收 |

> 每完成一个子阶段，更新本表、主计划 S9 行与 `code-review-s9-2026-11-11.md` 变更记录。

---

## 12. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-11-11 | 初始 S9 拆分计划：S9-A..E、spike、文件改动、测试、风险/回滚、DoD |
| 2026-11-11 | S9-A 实施完成：新增 shared `http` 契约与运行时检测；admin 鉴权改用 `ctx.ip`；删除 `RouterServer`，router 拆为 `fetch`/`upgrade`；WS peer/消息归一；`node:http + ws` on Bun spike 通过（101/text/binary/close/50 连接/remoteAddress）；typecheck/build 6/6，源码 975 pass / 21 skip / 0 fail，全量 1729 pass（dist 重建后） |
| 2026-11-11 | S9-B 实施完成：新增 Bun `HttpServer` adapter 与工厂；Core/Gateway 删除 `Bun.serve`，改由注入/默认 `HttpServer` 启停；两阶段 stop 语义收敛到 adapter；新增 5 个 adapter 契约测试；typecheck/build 6/6，源码 980 pass / 21 skip / 0 fail，全量（build 后）1739 pass；`Bun.serve`/`requestIP` 仅剩 adapter 与待清理 fixture |
