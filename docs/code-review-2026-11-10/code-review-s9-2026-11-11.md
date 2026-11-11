# Atom Neo Code Review — S9 HTTP/WS Runtime — 2026-11-11

> **Baseline**: `code-review/2026-11-10` @ `fc78eac` (v1.22.9)
> **Scope**: Core/Gateway HTTP + WebSocket、admin IP 鉴权、Node 入口
> **Status**: S9-A/B/C/D/E 已实施（S9 完成；版本 1.22.10）
> **Related**:
> - [code-review-s9-graph-2026-11-11.md](./code-review-s9-graph-2026-11-11.md)
> - [code-review-s9-plan-2026-11-11.md](./code-review-s9-plan-2026-11-11.md)
> - [code-review-2026-11-10.md](./code-review-2026-11-10.md)（CR-RUN-06、CR-ARCH-04）

---

## 0. 使用说明

1. 问题 ID 固定为 `S9-*`，实施提交、测试和计划统一引用。
2. `当前` 代码来自 `fc78eac`；`目标` 是改造方向，不要求逐字照抄。
3. 行号会随重构漂移；定位优先搜索函数名、类型名和注释锚点。
4. S9 拆分为 S9-A..S9-E，阶段顺序与依赖见 [实施计划](./code-review-s9-plan-2026-11-11.md)。
5. 本文件只覆盖 HTTP/WS 运行时本身；Node 构建、CI、发布属于 S10。

### 级别

| 级别 | 含义 | 处理阶段 |
|---|---|---|
| 阻断 | 不解决则 Node 无法启动，或 admin 鉴权错误 | S9-A/C |
| 高 | 双运行时行为可能分歧，或生命周期/连接泄漏 | S9-B/C/D |
| 中 | 结构重复、测试缺口、文档失真 | S9-D/E |

### 问题统计

| 类别 | 数量 | 说明 |
|---|---:|---|
| HTTP 运行时 | 5 | `Bun.serve`、`RouterServer`、upgrade、Request 桥接、stop 语义 |
| WebSocket | 3 | peer 类型、peer 身份/清理、消息数据形态 |
| Admin / IP | 1 | `requestIP` 依赖 |
| Gateway | 2 | 独立 `Bun.serve`、模块级 Logger |
| 入口 | 1 | 运行时选择与 Node 入口 |
| 测试 / 文档 | 2 | 双运行时契约测试、文档同步 |

### 原审查 ID 映射

| S9 ID | 原审查 ID | 说明 |
|---|---|---|
| S9-RUN-01..05 | CR-RUN-06 | Core/Gateway HTTP、upgrade、Request 桥接、stop |
| S9-WS-01..03 | CR-RUN-06 | WebSocket peer、生命周期、消息形态 |
| S9-ADM-01 | CR-RUN-06 | admin IP 鉴权 |
| S9-GW-01 | CR-RUN-06 | Gateway 独立 HTTP server |
| S9-GW-02 | CR-ARCH-04 | Gateway 模块级 Logger |
| S9-ENTRY-01 | CR-RUN-06 | Node 入口与运行时选择 |
| S9-TEST-01 | CR-RUN-06 | 双运行时契约测试 |
| S9-DOC-01 | CR-DOC-01..10 | 文档同步（仅 S9 相关部分） |

---

## 1. 结论与范围

### 结论

S9 不建议一次替换。当前代码只有一层薄薄的 Bun 绑定，但这层绑定同时影响 HTTP 路由、WebSocket 生命周期、admin 鉴权和两个进程入口。按以下五个子阶段推进：

```text
S9-A 契约/类型 + ws-on-Bun spike
  → S9-B Bun Adapter（保持现有行为）
  → S9-C Node Adapter（Node 可选启用）
  → S9-D Node 入口与运行时选择
  → S9-E 双运行时验收与清理
```

### 范围内

- Core 的 HTTP + WebSocket 传输。
- Gateway 的 HTTP 传输（Gateway 不提供 WebSocket）。
- admin token 的 loopback/IP 判断。
- `startCore` / `startGateway` 的传输注入。
- Node 源码入口的运行时选择。
- 双运行时契约测试与文档。

### 范围外

- Node 构建产物、`tsconfig` 拆分、CI 矩阵、发布包（S10）。
- 全局 registry / DI 收口（S11）。
- TUI 结构重构（S12）。
- 未实现 Element、Replay、PipelineRunner/Manager（禁区）。
- WS 事件名、HTTP 路由、状态码、Task/Event 契约的任何改变。

---

## 2. 当前运行面清单

| 能力 | 当前实现 | 位置 | Node 可用 |
|---|---|---|---|
| Core HTTP | `Bun.serve` / `Bun.Server` | `src/packages/core/src/server.ts` | 否 |
| Core WS | Bun `ServerWebSocket` | `src/packages/core/src/ws/handler.ts`、`src/packages/core/src/ws/broadcaster.ts` | 否 |
| HTTP 路由 | `Request → Response` + Bun server 形状 | `src/packages/core/src/http-router.ts` | 部分（类型绑定） |
| admin IP | `srv.requestIP(req)` | `src/packages/shared/src/utils/admin-auth.ts` | 否 |
| Gateway HTTP | `Bun.serve` | `src/packages/gateway/src/server.ts` | 否 |
| 进程入口 | `process.argv` + `import.meta.main` | `src/main.ts` | 部分（缺传输选择） |
| 开发 fixture | `Bun.serve` | `src/bootstrap/fixtures/gateway-client.ts` | 仅 Bun |
| 文档服务 | `node:http` | `docs/server.ts` | 是（独立实现） |

> `docs/server.ts` 已经证明 `node:http` 在本项目可用，但它不承载 Core 路由、WS、鉴权和任务生命周期，不能直接复用。

---

## 3. HTTP 运行时

### S9-RUN-01 — Core 直接绑定 `Bun.serve` / `Bun.Server`

**级别**: 阻断 · **阶段**: S9-A/B

**位置**: `src/packages/core/src/server.ts:49-87`

**当前**:

```ts
let server: Bun.Server<unknown> | undefined;

server = Bun.serve<unknown>({
  port,
  hostname: host,
  fetch: router,
  websocket: core.wsHandlers,
});
```

**问题**:

- `startCore` 同时是组合根和传输实现，Node 无法替换。
- `Bun.Server` 类型进入 `startCore` 的局部状态，测试无法注入 fake server。
- `server.stop(false)` / `server.stop(true)` 是 Bun 语义，Node 的 `close` / `closeAllConnections` 需要不同实现。
- 端口、host、WS handlers 与业务装配耦合，S9-C 无法只替换传输层。

**目标**:

```ts
export type CoreHandle = {
  port: number;
  tools: string[];
  toolInfos: { name: string; source: string; description: string; online?: boolean }[];
  mcpServerInfos: { name: string; online: boolean; toolCount: number }[];
  stop: () => Promise<void>;
};

export async function startCore(deps: CoreDeps & { httpServer?: HttpServer }): Promise<CoreHandle> {
  const httpServer = deps.httpServer ?? await createHttpServer();
  const core = createCoreBootstrap({ ...deps, isStopping });
  const router = createHttpRouter({ /* ... */ });

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

  logger.info("core ready", { port: handle.port, address: host });
  return { port: handle.port, /* ... */ stop };
}
```

**约束**:

- `startCore` 的返回结构不变。
- `Bun.serve` 只允许出现在 Bun adapter。
- 默认路径仍由工厂自动选择；测试和 Node 入口可显式注入。

---

### S9-RUN-02 — `RouterServer` 是 Bun server 的结构镜像

**级别**: 阻断 · **阶段**: S9-A/B

**位置**: `src/packages/core/src/http-router.ts:26-31`

**当前**:

```ts
/** Minimal Bun.Server surface used by routes; Bun's server object is structurally compatible. */
export type RouterServer = {
  requestIP(req: Request): { address: string } | null;
  port?: number;
  upgrade?(req: Request, options: { data: unknown }): boolean;
};
```

**问题**:

- 路由层直接依赖 `requestIP`，Node 必须伪造一个 Bun server 对象。
- `port` 可选，attach 响应可能得到 `undefined`；Node 适配器无法自然满足这个形状。
- `upgrade` 放在 fetch 的第二个参数里，意味着“HTTP 请求”和“升级请求”仍然混在同一个回调。
- `requireAdmin(req, srv, ...)` 被路由和 Gateway 共享，签名锁死了 Bun。

**目标**:

```ts
// packages/shared/src/http/types.ts（新增）
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
```

```ts
// core/src/http-router.ts（目标）
export function createHttpRouter(deps: HttpRouterDeps): HttpRouter<WsData> {
  return {
    async fetch(req, ctx) {
      const denied = requireAdmin(req, ctx, deps.adminToken, deps.allowRemoteAdmin);
      if (denied) return denied;
      const url = new URL(req.url);
      if (url.pathname.startsWith("/ws/")) {
        return decodePathParam(url.pathname, "/ws/")
          ? new Response("Upgrade Required", { status: 426 })
          : Response.json({ error: "Invalid session ID" }, { status: 400 });
      }
      // ... 现有路由
      return new Response("Not Found", { status: 404 });
    },
    upgrade(req, ctx) {
      const url = new URL(req.url);
      if (!url.pathname.startsWith("/ws/")) return undefined;
      const sid = decodePathParam(url.pathname, "/ws/");
      if (!sid) return { response: Response.json({ error: "Invalid session ID" }, { status: 400 }) };
      return { data: { sessionId: sid } };
    },
  };
}
```

**约束**:

- 路由优先级不变。
- `/api/tui/attach` 的 `port` 改为 `ctx.port`，值来自监听后的真实端口。
- `RouterServer` 类型删除；不再从 `bun` 导入任何类型。

---

### S9-RUN-03 — upgrade 分支与 `Response | undefined` 没有跨运行时语义

**级别**: 高 · **阶段**: S9-A/C

**位置**: `src/packages/core/src/http-router.ts:104-109`

**当前**:

```ts
// WebSocket upgrade for /ws/:sessionId
if (url.pathname.startsWith("/ws/")) {
  const sid = decodePathParam(url.pathname, "/ws/");
  if (!sid) return Response.json({ error: "Invalid session ID" }, { status: 400 });
  srv.upgrade?.(req, { data: { sessionId: sid } });
  return; // handled by websocket handlers
}
```

**问题**:

- `return;` 让 fetch 返回 `undefined`，只有 Bun 的 `srv.upgrade` 能接住。
- Node 的 HTTP `request` 与 `upgrade` 是两个事件：普通 request handler 里无法“返回 undefined 等待升级”。
- `srv.upgrade?.()` 使用可选调用，适配器缺失时静默失败，客户端看到空响应。
- 非法 sid 返回 400，但合法 sid + 非 Upgrade 请求会落到 `srv.upgrade` 失败，行为未锁定。

**目标**:

```ts
// Bun adapter
const decision = options.upgrade?.(req, ctx);
if (decision && "response" in decision) return decision.response;
if (decision) {
  const ok = srv.upgrade(req, { data: decision.data });
  if (!ok) return new Response("Upgrade Required", { status: 426 });
  return undefined;
}
return options.fetch(req, ctx);
```

```ts
// Node adapter
server.on("upgrade", async (req, socket, head) => {
  const request = toWebRequest(req, port);
  const ctx = { runtime: "node", ip: remoteIp(req), port };
  const decision = options.upgrade?.(request, ctx);
  if (!decision) return rejectUpgrade(socket, 404, "Not Found");
  if ("response" in decision) return writeResponseToSocket(socket, decision.response);
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req, decision.data);
  });
});
```

**验收**:

- 合法 `/ws/:sessionId` + Upgrade → 101，`session.ready` 与当前完全一致。
- 非法 sid → 400。
- 合法路径但无 Upgrade 头 → 426，不挂起连接。
- 非 `/ws/` 路径的 Upgrade → 404。

---

### S9-RUN-04 — 缺少 Node `Request` ↔ `IncomingMessage/ServerResponse` 桥接

**级别**: 阻断 · **阶段**: S9-C

**位置**: 缺失；当前路由全部使用 Web `Request` / `Response`。

**当前**:

```ts
// core/src/http-router.ts
return async (req: Request, srv: RouterServer) => {
  const url = new URL(req.url);
  const body = await req.json().catch(() => ({}));
  return Response.json({ ok: true });
};
```

**问题**:

- Node 的 `IncomingMessage` 不是 Web `Request`，`ServerResponse` 不是 Web `Response`。
- POST body、headers、重复 `Set-Cookie`、204/304/HEAD、流式响应、客户端中断都需要显式处理。
- 直接 `JSON.stringify(await req.json())` 的临时桥接无法覆盖 attach 的空 body、task 的 JSON、config 的 PATCH/DELETE 和未来的流式响应。
- 如果桥接错误，现有测试全部跑在 Bun 下不会发现。

**目标**:

```ts
// packages/shared/src/http/node-http-server.ts（新增，节选）
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

**必须覆盖**:

| 场景 | 期望 |
|---|---|
| `GET /api/health` | 200 JSON，无 body 桥接 |
| `POST /api/tasks` | JSON body 可读，`content-length`/chunked 均可 |
| `POST /api/tui/attach` 空 body | 等价于 `{}` |
| `PATCH /api/config/runtime` | JSON body + 4xx Zod 错误 |
| `DELETE /api/config/runtime` | 无 body，200 |
| `HEAD` | 不写 body，保留 headers |
| `204/304` | 不写 body |
| 客户端中断 | 不产生未捕获异常，释放请求资源 |
| 多 `Set-Cookie` | 全部保留（当前 Core 不用，但适配器必须正确） |

**约束**:

- 不引入 Express/Fastify 等框架。
- 不改变 `Request`/`Response` 在路由内部的用法。
- `duplex: "half"` 只在 Node 需要；用局部类型断言隔离，不污染 shared 类型。

---

### S9-RUN-05 — 缺少统一的 stop / drain / keep-alive 语义

**级别**: 高 · **阶段**: S9-B/C

**位置**: `src/packages/core/src/server.ts:52-80`、`src/packages/gateway/src/server.ts:170-180`

**当前**:

```ts
stopPromise = (async () => {
  stopping.value = true;
  clearInterval(core.sessionSweepTimer);
  server?.stop(false);
  // ... drain ...
  await server?.stop(true);
})();
```

**问题**:

- Bun `stop(false)` 立即停止接收；Node `server.close()` 的 callback 要等所有连接结束，WS 长连接会导致永不 resolve。
- 第一次 `stop(false)` 与最后 `stop(true)` 的职责没有写进契约，Node 适配器只能猜。
- `keep-alive` 空闲连接、正在处理的 HTTP 请求、WebSocket 连接需要分别处理。
- Gateway 的 stop 也各自实现，容易与 Core 分歧。

**目标**:

```ts
export type HttpServerHandle = {
  readonly port: number;
  readonly runtime: HttpRuntime;
  /** false: 停止接收新连接并关闭空闲 keep-alive；true: 关闭所有连接。幂等。 */
  stop(force?: boolean): Promise<void>;
};
```

| 调用 | 行为 |
|---|---|
| `stop(false)` | 停止 listen；关闭空闲 keep-alive；保留正在处理的 HTTP 与 WS；监听 socket 关闭后 resolve |
| `stop(true)` | 先执行 `stop(false)`；WS 以 1001 关闭；HTTP active socket 强制销毁；全部关闭后 resolve |
| 重复调用 | 同一模式返回同一 Promise；`stop(true)` 可升级已发起的 `stop(false)` |
| `port = 0` | handle 返回系统分配的真实端口 |

**Node 实现要点**:

- `server.close()` 负责停止接收。
- `server.closeIdleConnections()` 关闭空闲 keep-alive。
- `server.closeAllConnections()` 只在 `force=true` 调用。
- `wss.clients` 在 `force=true` 时逐个 `close(1001, "server shutdown")`。
- `wss.close()` 与 HTTP `close` 都要等待，但不要因为长连接阻塞 `stop(false)`。

---

## 4. WebSocket 运行时

### S9-WS-01 — `ServerWebSocket` 类型泄漏到 handler / broadcaster

**级别**: 阻断 · **阶段**: S9-A/B

**位置**:
- `src/packages/core/src/ws/handler.ts:1,42,57,71,80,156`
- `src/packages/core/src/ws/broadcaster.ts:1,4,9,12,16,20,71`

**当前**:

```ts
// ws/handler.ts
import type { ServerWebSocket } from "bun";

function wsData(ws: ServerWebSocket<unknown>): WsData {
  return (ws.data ?? {}) as WsData;
}

message(ws: ServerWebSocket<unknown>, msg: string | Buffer) { /* ... */ }
close(ws: ServerWebSocket<unknown>) { ctx.broadcaster.remove(ws); }
```

```ts
// ws/broadcaster.ts
import type { ServerWebSocket } from "bun";

export class Broadcaster {
  #clients = new Map<ServerWebSocket<unknown>, Client>();
  add(ws: ServerWebSocket<unknown>, sessionId: string): void { /* ... */ }
  remove(ws: ServerWebSocket<unknown>): void { /* ... */ }
}
```

**问题**:

- 运行时代码直接依赖 `bun` 类型；Node adapter 无法提供 `ServerWebSocket`。
- `ws.data` 是 Bun 的升级载荷字段，Node `ws` 没有同名语义。
- 类型泄漏会让 `rg 'ServerWebSocket'` 无法收敛到适配层。
- handler 与 broadcaster 的 peer 身份必须稳定，否则 close 清理会失效。

**目标**:

```ts
// packages/shared/src/http/types.ts（新增）
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
```

```ts
// core/src/ws/handler.ts（目标）
import type { WebSocketPeer } from "@atom-neo/shared";

type WsPeer = WebSocketPeer<WsData>;

function wsData(ws: WsPeer): WsData {
  return (ws.data ?? {}) as WsData;
}

open(ws: WsPeer) { /* ... */ }
message(ws: WsPeer, msg: string | Uint8Array) { /* ... */ }
close(ws: WsPeer) { ctx.broadcaster.remove(ws); }
```

**Bun 适配**:

Bun 的 `ServerWebSocket` 结构上满足 `data` / `send` / `close`，可以直接作为 `WebSocketPeer` 传入，不需要 wrapper。`ws.data` 继续由 `srv.upgrade(req, { data })` 设置。

**Node 适配**:

`ws.WebSocket` 没有 `data` 字段，必须用 `WeakMap<WebSocket, WebSocketPeer<WsData>>` 缓存同一个 peer。`open` / `message` / `close` 必须复用同一个引用，否则 `Broadcaster.remove(peer)` 删不掉。

---

### S9-WS-02 — peer 生命周期、close/drain 与 broadcaster key

**级别**: 高 · **阶段**: S9-A/B/C

**位置**: `src/packages/core/src/ws/broadcaster.ts:9-17,71-77`、`src/packages/core/src/ws/handler.ts:71-78,156-158`

**当前**:

```ts
export class Broadcaster {
  #clients = new Map<ServerWebSocket<unknown>, Client>();
  add(ws: ServerWebSocket<unknown>, sessionId: string): void {
    this.#clients.set(ws, { ws, sessionId });
  }
  remove(ws: ServerWebSocket<unknown>): void {
    this.#clients.delete(ws);
  }
  #sendSerialized(ws: ServerWebSocket<unknown>, data: string): void {
    try { ws.send(data); } catch { this.remove(ws); }
  }
}
```

**问题**:

- `send` 抛错时移除；但 Node `ws.send` 在 `CLOSING` 状态不一定同步抛错，可能静默丢帧。
- 没有 `error` 事件处理；Node socket error 后 broadcaster 可能保留死连接。
- Bun 有 `drain` 事件，Node `ws` 也有 `drain`；当前没有统一。
- 没有“close 只清理一次”的防重入。

**目标**:

- `Broadcaster` 以 `WebSocketPeer<WsData>` 为 key。
- `open` 添加；`close` 与 `error` 都调用 `remove`，重复调用安全。
- `send` 前检查 peer 是否可写；适配器负责 `readyState`。
- `drain` 可选，不改变协议。
- 连接数统计 `connectedClients` / `connectedSessions` 保持现有语义。
- `session.ready`、`task.created`、`task.state.changed`、`control.pong` 等消息内容不变。

**验收**:

- 连接 → `session.ready` → 断开 → `connectedClients` 归零。
- 发送中抛错 → 连接被移除，后续广播不包含该 peer。
- Node `error` 后不残留 peer。
- 同一 session 多连接时，广播只发给该 session。

---

### S9-WS-03 — 消息数据形态未归一

**级别**: 高 · **阶段**: S9-B/C

**位置**: `src/packages/core/src/ws/handler.ts:80`

**当前**:

```ts
message(ws: ServerWebSocket<unknown>, msg: string | Buffer) {
  try {
    const frame: unknown = JSON.parse(msg.toString());
    // ...
  } catch (err) {
    send(ws, WsMessages.Control.Error, { message: "Invalid message format" });
  }
}
```

**问题**:

- Bun 传入 `string | Buffer`；Node `ws` 传入 `Buffer | ArrayBuffer | Buffer[]`，并带 `isBinary`。
- `ArrayBuffer.toString()` 得到 `[object ArrayBuffer]`，会被当成 JSON 解析失败。
- `Buffer[]` 需要先拼接。
- 协议是 JSON 文本，二进制帧应稳定拒绝，而不是依赖 `toString()` 的偶然结果。

**目标**:

```ts
function decodeMessage(data: string | Uint8Array): string {
  return typeof data === "string" ? data : new TextDecoder().decode(data);
}

message(ws: WsPeer, msg: string | Uint8Array) {
  try {
    const frame: unknown = JSON.parse(decodeMessage(msg));
    // ...
  } catch {
    send(ws, WsMessages.Control.Error, { message: "Invalid message format" });
  }
}
```

**适配器归一**:

| 运行时 | 输入 | 归一 |
|---|---|---|
| Bun | `string` | 原样 |
| Bun | `Buffer` / `Uint8Array` | `new Uint8Array(...)` |
| Node `ws` | `isBinary=false` | `raw.toString()` |
| Node `ws` | `isBinary=true` | `new Uint8Array(raw)` → handler 解码失败 → `control.error` |
| Node `ws` | `Buffer[]` | `Buffer.concat(raw)` 后再按上表处理 |

**约束**:

- 不新增 WS 消息类型。
- 不改变 `control.error` 的文案和 code。
- 不以二进制方式传输协议帧。

---

## 5. Admin / IP

### S9-ADM-01 — `isAdminRequest` 依赖 `requestIP(req)`

**级别**: 阻断 · **阶段**: S9-A/C

**位置**: `src/packages/shared/src/utils/admin-auth.ts:1-8`、`src/packages/core/src/http-router.ts:56-60`、`src/packages/gateway/src/server.ts:109`

**当前**:

```ts
type IpResolver = { requestIP(req: Request): { address: string } | null };

const LOOPBACK_IPS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export function isAdminRequest(req: Request, srv: IpResolver, adminToken?: string, allowRemote = false): boolean {
  if (!adminToken || req.headers.get("x-atom-admin-token") !== adminToken) return false;
  const ip = srv.requestIP(req)?.address ?? "";
  return LOOPBACK_IPS.has(ip) || (allowRemote && ip !== "");
}
```

**问题**:

- shared 工具函数依赖 Bun server 形状，Gateway 也被迫使用。
- Node 没有 `requestIP`，只能伪造。
- Node 的 `socket.remoteAddress` 可能是 `::ffff:127.0.0.1`，现有集合已覆盖，但需要测试锁定。
- `X-Forwarded-For` 不能被信任；当前没有使用，改造后也不能引入。

**目标**:

```ts
export type AdminRequestContext = { readonly ip: string };

const LOOPBACK_IPS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export function isAdminRequest(
  req: Request,
  ctx: AdminRequestContext,
  adminToken?: string,
  allowRemote = false,
): boolean {
  if (!adminToken || req.headers.get("x-atom-admin-token") !== adminToken) return false;
  return LOOPBACK_IPS.has(ctx.ip) || (allowRemote && ctx.ip !== "");
}
```

**IP 来源**:

| 运行时 | `ctx.ip` |
|---|---|
| Bun | `srv.requestIP(req)?.address ?? ""` |
| Node | `req.socket.remoteAddress ?? ""` |
| 代理头 | 不读取 `X-Forwarded-For` / `X-Real-IP` |

**验收**:

- `127.0.0.1`、`::1`、`::ffff:127.0.0.1` + 正确 token → 允许。
- 远端 IP + 正确 token + `allowRemote=false` → 403。
- 远端 IP + 正确 token + `allowRemote=true` → 允许。
- 缺失 IP + token → 403（与当前 `ip !== ""` 语义一致）。
- 错误/缺失 token → 403。

---

## 6. Gateway

### S9-GW-01 — Gateway 独立 `Bun.serve`

**级别**: 高 · **阶段**: S9-B/D

**位置**: `src/packages/gateway/src/server.ts:102-170`

**当前**:

```ts
const server = Bun.serve({
  port: config.port,
  hostname: config.host,
  async fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === "/admin/clients" && req.method === "POST") {
      if (!isAdminRequest(req, srv, configOverrides?.adminToken)) {
        return Response.json({ error: "Forbidden" }, { status: 403 });
      }
      // ...
    }
    // ...
  },
});
config.port = server.port!;
```

**问题**:

- Core 与 Gateway 各有一份传输实现，Node 支持要改两遍。
- Gateway 的 admin 检查同样依赖 `srv.requestIP`。
- Gateway 没有 WebSocket，但仍被 Bun server 类型绑定。
- start/stop 语义与 Core 不一致，容易在 Node 下泄漏连接。

**目标**:

```ts
export type GatewayOverrides = Partial<GatewayConfig> & {
  adminToken?: string;
  logger?: Logger;
  httpServer?: HttpServer;
};

export async function startGateway(overrides?: GatewayOverrides): Promise<{ port: number; stop: () => Promise<void> }> {
  const config = loadGatewayConfig(overrides);
  const logger = overrides?.logger ?? createDefaultLogger();
  const httpServer = overrides?.httpServer ?? await createHttpServer();
  // ...
  const handle = await httpServer.serve({
    port: config.port,
    host: config.host,
    fetch: async (req, ctx) => { /* 现有路由，isAdminRequest(req, ctx, token) */ },
  });
  config.port = handle.port;
  // ...
  return { port: handle.port, stop: () => stopPromise ??= (async () => {
    stopping = true;
    await handle.stop(false);
    try { await cm.stopAll(); } finally { await handle.stop(true); }
  })() };
}
```

**约束**:

- Gateway 不注册 `upgrade` / `websocket`；升级请求返回 404/426。
- `/admin/clients`、`/gateway/inbound`、`/gateway/event` 的路径、鉴权、状态码、响应体不变。
- Gateway 仍然只监听 `127.0.0.1`。
- `startGateway` 的返回结构不变。

---

### S9-GW-02 — Gateway 模块级 Logger（CR-ARCH-04 遗留）

**级别**: 中 · **阶段**: S9-D

**位置**: `src/packages/gateway/src/server.ts:9-11`

**当前**:

```ts
const logHub = new LogHub();
logHub.addSink(new StdoutSink());
const logger = new Logger("info", (entry) => logHub.write(entry));
```

**问题**:

- import 即创建日志器和 sink，产生副作用。
- 忽略 `--log*` 参数；Core 入口的日志配置无法传给 Gateway。
- 测试无法注入 silent logger。
- 与 S9-D 的入口注入同一批改动，适合一起收口。

**目标**:

- 删除模块级 `logHub` / `logger`。
- `startGateway` 接收 `logger`，必填或显式默认。
- 仅在 `if (import.meta.main)` 的入口分支创建默认 logger。
- `src/main.ts` 启动 Gateway 时传入自己的 logger。

**验收**:

- import `@atom-neo/gateway` 不产生日志。
- `startGateway({ logger: silent })` 测试无 stdout 噪音。
- `--log` / `--log-level` 对 Gateway 生效。

---

## 7. Node 入口

### S9-ENTRY-01 — 运行时选择与 Node 入口未定义

**级别**: 高 · **阶段**: S9-D

**位置**: `src/main.ts:164,239`、`package.json` engines

**当前**:

```ts
// main.ts
const core = await startCore({ /* ... */ });
// ...
if (import.meta.main) {
  main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
}
```

**问题**:

- `startCore` / `startGateway` 内部直接创建 Bun 传输，入口无法选择 Node。
- 没有运行时检测函数，也没有 `ATOM_HTTP_RUNTIME` 约定。
- `import.meta.main` 在 Bun 与 Node 24.2+ 都存在，但 `@types/bun` 之外的 Node 类型环境需要显式兼容。
- 如果 Node 路径静态 import Bun adapter，可能在模块加载时触碰 `Bun` 全局。

**目标**:

```ts
// packages/shared/src/http/detect.ts（新增）
export type HttpRuntime = "bun" | "node";

export function resolveHttpRuntime(explicit?: string): HttpRuntime {
  const value = explicit ?? process.env.ATOM_HTTP_RUNTIME;
  if (value === "bun" || value === "node") return value;
  return typeof Bun !== "undefined" ? "bun" : "node";
}
```

```ts
// packages/shared/src/http/create-http-server.ts（新增）
export async function createHttpServer(runtime = resolveHttpRuntime()): Promise<HttpServer> {
  if (runtime === "bun") {
    const { createBunHttpServer } = await import("./bun-http-server");
    return createBunHttpServer();
  }
  const { createNodeHttpServer } = await import("./node-http-server");
  return createNodeHttpServer();
}
```

```ts
// main.ts（目标）
const runtime = resolveHttpRuntime();
const httpServer = await createHttpServer(runtime);
// startCore({ ..., httpServer })
```

**运行时选择规则**:

| 条件 | 结果 |
|---|---|
| `ATOM_HTTP_RUNTIME=bun` | 强制 Bun adapter；Node 下缺少 `Bun` 全局时启动失败并给出明确错误 |
| `ATOM_HTTP_RUNTIME=node` | 强制 Node adapter；Bun 下仅在 spike 证明 `ws` 可用时允许 |
| 未设置，存在 `Bun` 全局 | Bun adapter（默认路径不变） |
| 未设置，无 `Bun` 全局 | Node adapter |

**入口约束**:

- 默认入口仍是 `src/main.ts`，不新增分叉的 `main.node.ts`。
- `main.ts` 的 `process.argv` 用法保持不变。
- `import.meta.main` 改为兼容访问：
  ```ts
  import { fileURLToPath } from "node:url";

  const metaMain = (import.meta as ImportMeta & { main?: boolean }).main;
  const isMain = metaMain ?? process.argv[1] === fileURLToPath(import.meta.url);
  if (isMain) { /* ... */ }
  ```
- `import.meta.main` 在 Node 24.2+ 可用；24.0/24.1 走 `argv[1]` fallback。Bun 编译二进制仍由 `import.meta.main` 判定，S10 再固化打包入口。
- Node 构建与发布仍由 S10 完成；S9 只保证源码路径可运行、可 smoke。

---

## 8. 测试 / 文档

### S9-TEST-01 — 缺少双运行时 HTTP/WS 契约测试

**级别**: 中 · **阶段**: S9-E

**位置**: 现有 `src/packages/core/src/http-router.test.ts`、`src/packages/core/src/server.test.ts`、`src/packages/core/src/ws/` 测试全部跑在 Bun。

**问题**:

- 类型检查通过不代表 Node 适配器能处理真实 `IncomingMessage` / `ws` 帧。
- admin IP、upgrade、关闭顺序、keep-alive 都可能在 Node 下分歧。
- 没有一套“同一场景、两个运行时”的验收口径。

**目标**:

- Bun：继续使用 `bun:test`，覆盖 router、WS、Core 启停。
- Node：新增 `scripts/node-smoke/http-runtime.ts`，使用 `node:assert/strict` + `fetch` + `ws` 客户端。
- 两边跑同一组场景：

| 场景 | 断言 |
|---|---|
| Core start `port: 0` | 返回真实端口，`/api/health` 200 |
| `POST /api/tui/attach` | 200，`sessionId` / `serverInfo` 字段完整 |
| admin 403/200 | 错误 token 403；loopback + 正确 token 200 |
| `POST /api/tasks` | 202/201，fake model 完成 |
| `GET /api/tasks/:id` | 状态流转到 completed |
| WS `/ws/:sessionId` | 收到 `session.ready`，`control.ping` → `control.pong` |
| WS `task.submit` | 收到 `task.created`，任务完成广播 |
| 断开 WS | `connectedClients` 归零，不影响任务 |
| Gateway start/stop | 端口可用，`/admin/clients` 鉴权一致 |
| 强制关闭 | 无残留连接/进程 |

**约束**:

- 不迁移全部 `bun:test` 到 Node。
- 不引入新的测试框架。
- Node smoke 只依赖 Node 标准库 + `ws` + 已构建/可执行的入口。

---

### S9-DOC-01 — 启动/协议/目录文档未反映运行时选择

**级别**: 中 · **阶段**: S9-E

**位置**:
- `docs/overview/bootstrap.md`
- `docs/communication/gateway.md`
- `docs/communication/protocol.md`
- `docs/overview/project-structure.md`

**问题**:

- 文档只描述 Bun 入口，没有 `ATOM_HTTP_RUNTIME` 和双运行时 stop 语义。
- Gateway 文档没有说明它使用同一 `HttpServer`、不提供 WS。
- `protocol.md` 没有声明“传输可变、协议不变”。
- 目录树没有 `shared/src/http` 新模块和 `ws` 依赖。

**目标**:

- `bootstrap.md`：运行时选择、默认值、Node smoke 命令、两阶段 stop。
- `gateway.md`：`HttpServer` 注入、无 WS、Logger 注入。
- `protocol.md`：增加“传输层无关”说明；所有事件/路由/状态码保持不变。
- `project-structure.md`：新增 `shared/src/http/` 文件表；`ws` 依赖说明。
- `development-setup.md`：Node smoke 运行方式（若命令稳定）。

**约束**:

- 不复制实现细节到多篇文档；以 S9 三份文档为设计源，其他文档只做结论引用。
- 不改变协议文档中的既有消息定义。

---

## 9. 目标契约汇总

### 9.1 HTTP 契约

```ts
// packages/shared/src/http/types.ts（新增）
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

### 9.2 WebSocket 契约

```ts
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
```

### 9.3 不变式

| 不变式 | 说明 |
|---|---|
| 路由不变 | 路径、方法、优先级、状态码、JSON 字段与 `fc78eac` 一致 |
| WS 协议不变 | `EVENTS` / `WsMessages` 字符串、seq/ts envelope、payload 结构不变 |
| 任务契约不变 | `TaskSubmissionService`、TaskQueue、TaskEngine、Task lifecycle 不变 |
| admin 不变 | header 名、token 比对、loopback 判定、`allowRemote` 语义不变 |
| 关闭顺序不变 | WS → timers → hooks/schedules → background shell → drain → checkpoint → MCP → context → server |
| 禁区不变 | 未实现 Element、Replay、PipelineRunner/Manager 不改 |

---

## 10. 阶段验收摘要

| 阶段 | 验收 |
|---|---|
| S9-A | 契约类型编译通过；Bun 行为不变；`ServerWebSocket` 只在 Bun adapter；spike 结论落盘 |
| S9-B | Core/Gateway 均通过 `HttpServer`；`Bun.serve` 只在 Bun adapter；现有测试全绿 |
| S9-C | Node 下 health/attach/task/WS/gateway smoke 通过；admin IP 正确；Bun 不受影响 |
| S9-D | `ATOM_HTTP_RUNTIME` 生效；Bun 默认不变；Node 入口可启动；Gateway logger 可注入 |
| S9-E | 同一组 HTTP/WS 场景双运行时通过；残留检查通过；文档同步 |

**S9-E 结果（2026-11-11）**：Node fake conversation smoke 11 项 PASS、Bun→Node cross-runtime smoke 7 项 PASS，既有 adapter/Core Node smoke 各 9 项 PASS；源码 1001 pass / 21 skip / 0 fail，全量 1781 pass；`Bun.serve`/`Bun.Server`/`requestIP` 仅 Bun adapter，`from "bun"`/`ServerWebSocket` 为 0；版本 1.22.10。Spike 通过但保留双 adapter，S10 再评估统一。

---

## 11. 禁区

- 不修改 `docs/communication/protocol.md` 中已有的消息名、payload、状态码。
- 不删除/重命名现有 HTTP 路由。
- 不改变 `TaskSubmissionService` 的提交与去重/冲突行为。
- 不修改未实现的 Element、Replay、PipelineRunner/Manager。
- 不为 `node:fs/path/crypto` 造抽象。
- 不把 `ws` 依赖引入 TUI 浏览器代码路径。
- 不在 S9 做 S10 的构建/发布改造。

---

## 12. 验收命令

```bash
# 类型
bun run typecheck

# 源码测试（排除 dist）
bun test --path-ignore-patterns='**/dist/**'

# 全量测试
bun test

# 构建
bun run build

# 文档
bun run docs:check
bun run docs:typecheck

# Bun 路径
bun run src/main.ts --mode core --port 0 --sandbox ./sandbox

# Node 路径（S9-D 后）
ATOM_HTTP_RUNTIME=node node dist/node/main.js --mode core --port 0 --sandbox ./sandbox

# 残留检查（S9-E）
rg -n 'Bun\.serve|Bun\.Server|ServerWebSocket|requestIP' src --glob '!**/dist/**' --glob '!**/node_modules/**' --glob '!**/*.test.ts'
# 期望：只匹配 http/bun-http-server.ts 与 bun 类型声明
```

---

## 13. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-11-11 | 初始 S9 专项审查：拆分 S9-A..E，记录 14 个问题、目标契约、兼容矩阵与验收命令 |
| 2026-11-11 | S9-A 实施完成：`packages/shared/src/http` 契约与 `resolveHttpRuntime`；`isAdminRequest(req, { ip })`；`RouterServer` 删除，router 拆为 `fetch`/`upgrade`，`/ws/` 无 Upgrade 返回 400/426，attach 使用 `ctx.port`；WS 改用 `WebSocketPeer` 并归一消息；`ws` on Bun spike 通过（101/text/binary/close/50 连接/remoteAddress，`EXIT=0`）；typecheck/build 6/6，源码 975 pass / 21 skip / 0 fail，全量 1729 pass（dist 重建后） |
| 2026-11-11 | S9-B 实施完成：新增 Bun `HttpServer` adapter（`bun-http-server.ts`）与工厂（`create-http-server.ts`）；Core/Gateway 删除 `Bun.serve` 并改由 `HttpServer` 启停，admin 使用 adapter 提供的 `ctx.ip`；两阶段 stop（`stop(false)` 立即返回 / `stop(true)` 强制关闭）收敛到 adapter；新增 5 个 adapter 契约测试；typecheck/build 6/6，源码 980 pass / 21 skip / 0 fail，全量（build 后）1739 pass |
| 2026-11-11 | S9-C 实施完成：新增 Node `node:http` + `ws` adapter（`node-http-server.ts`、`node-websocket-peer.ts`）；HTTP body/header/204/304/HEAD/Set-Cookie 桥接；upgrade 404/400/426/101；WeakMap peer、text/binary 归一、close-once；两阶段 stop；shared 新增 `ws`/`@types/ws` 并更新 lockfile；新增 12 个契约测试与真实 Node smoke（9 项 PASS）；typecheck/build 6/6，源码 992 pass / 21 skip / 0 fail，全量（build 后）1763 pass |
| 2026-11-11 | S9-D 实施完成：`resolveHttpRuntime` 显式参数优先、空 env 回退、非法值 fail-fast；`createHttpServer` 对缺失 Bun 全局/非法 runtime 明确报错；`main.ts` 统一解析运行时并向 Core/Gateway 注入同一 `HttpServer`，入口判断兼容 Node `fileURLToPath`；Gateway logger 改为注入、默认静默并移除模块级 logger；新增 `detect.test.ts`（7）与 `gateway/server.test.ts`（2），真实 Node Core smoke 9 项 PASS；bundle `main.ts --target node` 后 `--help` 正常；typecheck/build 6/6，源码 1001 pass / 21 skip / 0 fail，全量（build 后）1781 pass |
| 2026-11-11 | S9-E 实施完成（S9 完成）：新增 Node fake conversation smoke（本地 fake SSE model，conversation `completed` + assistant 消息，11 项 PASS）与 Bun→Node cross-runtime smoke（真实 Node 入口 bundle，attach + `session.ready` + SIGTERM，7 项 PASS）；fixture `gateway-client.ts` 改 `node:http`，Gateway 入口判断兼容 Node 24.0/24.1；`Bun.serve`/`Bun.Server`/`requestIP` 仅 Bun adapter，`from "bun"`/`ServerWebSocket` 为 0；源码 1001 pass / 21 skip / 0 fail，全量 1781 pass；版本 1.22.10；保留双 adapter，S10 再评估统一 |
