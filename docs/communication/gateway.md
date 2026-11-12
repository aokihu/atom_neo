# Gateway — 平台 Client 中转层

> **Purpose**: Gateway 是 Atom Neo 的平台 Client 中转层。通过管理平台 Client 子进程，将微信、Telegram 等外部平台的消息标准化后路由到 Core 引擎。

## Gateway Client 控制模式（已实现）

2026-09-12：本节代码已实现；测试和进程级验收已归档。详见 [启动模式计划](../records/startup-modes-plan.md) 与 [验收记录](../records/startup-validation.md)。

| 入口 | 职责 |
|------|------|
| --mode core-gateway | 启动 Core 与 Gateway Server，不启动 TUI |
| --mode gateway --clients <client_name> | 控制已配置的指定 Client |
| --mode gateway（省略 clients） | 控制全部配置 Clients |

clients 使用配置 ID，空值不是全部。动作参数为必填 --action start|stop。控制命令为短时进程，Gateway 不在线则报错，不自动启动 Server。已运行 start、已停止 stop 幂等，全部操作报告逐项结果及失败退出码。

新增 POST /admin/clients 本机管理接口，与 /gateway/* 平台消息接口分开认证；平台 Client secret 没有管理权限。建议受限权限运行描述供控制命令发现 Gateway 地址及管理凭据；实例校验和清理归属遵循启动计划。

ClientManager 复用 spawn/stop，增加公开按 ID 操作、期望状态、可取消重启计时器与进程实例检查。手动停止不被重启回调复活；旧 secret 在退出/重启时撤销；退避失败次数不在每次 spawn 清零。Gateway.stop 必须等待 stopAll，失败启动回滚资源。启动就绪应检查健康，不把 spawn 成功等同 ready。

Gateway 向 Core 提交创建信息 initiator={type:gateway,clientId,platform}，身份取认证后的配置。现有 ID 规则暂不迁移；不同 Client 对已有会话的发起者冲突必须拒绝覆盖。

停止 Client 不取消 Core 已接受任务；投递失败沿用现有错误处理，不新增补投递队列。定时任务主动向平台发送结果不属于此项控制改造。

## 1. 架构

```
外部平台                   Client (子进程)              Gateway                     Core
┌──────────┐   webhook  ┌──────────────────┐  HTTP  ┌─────────────────────┐  HTTP  ┌──────┐
│ Telegram │───────────→│ Telegram Bot     │───────→│ /gateway/inbound    │───────→│      │
│ API      │←───────────│ ├ HTTP Server     │←───────│ ├ Secret 验证        │←───────│ Core │
└──────────┘  sendMsg   │ ├ 长轮询/Webhook  │        │ ├ Message → Task    │        │      │
                        │ └ 平台逻辑        │        │ ├ Poll Task Result  │        │      │
                        └──────────────────┘        │ └ Push Result→Client│        └──────┘
```

**原则：**
- Gateway **不感知**平台细节（Telegram API 格式、消息转换等）
- Client 负责**所有平台特定逻辑**（webhook 管理、消息收发、格式转换）
- Gateway 是 **Client ↔ Core** 的安全中转层
- Client 和 Gateway 之间通过 **HTTP API + Secret** 双向通信
- Gateway **仅监听 127.0.0.1**，仅供本机 Client 子进程访问

### 1.1 传输与日志

Gateway 与 Core 共用 `@atom-neo/shared` 的 `HttpServer` 契约（`src/packages/shared/src/http`）：

- `startGateway` 接受可选 `httpServer`；未注入时按 `ATOM_HTTP_RUNTIME` 创建（默认 Bun，Node 可选）。`--mode core-gateway` 下 `src/main.ts` 注入与 Core 相同的无状态实例，两者各自 `serve` 不同端口。
- Gateway 只注册 HTTP `fetch`，不注册 `upgrade` / `websocket`；不提供 `/ws/*`，升级请求按普通 HTTP 返回 404。
- 模块级 logger 已移除，import 无日志副作用。未注入 `logger` 时为静默 `Logger`；`--mode core-gateway` 传入 `main.ts` 的 logger，因此 `--log*` 对 Gateway 生效。`if (import.meta.main)` 独立启动时才创建 stdout logger。
- 两阶段关闭与 Core 一致：`handle.stop(false)` 停止接收，Gateway 清理 Clients 后 `handle.stop(true)` 关闭连接。路由、鉴权、状态码与返回结构不变。

## 2. 路由

当前实现仅暴露一类路由，仅供 Client 子进程使用；新增管理接口见上节：

| 路由前缀 | 验证方式 | 用户 | 用途 |
|---------|---------|------|------|
| `/gateway/*` | `X-Gateway-Secret` Header | Client 子进程 | 消息中转 |

**Gateway 端点：**

| 端点 | 方法 | 说明 |
|------|------|------|
| `/gateway/inbound` | POST | Client 将平台消息提交给 Gateway |
| `/gateway/event` | POST | Client 上报平台连接状态事件 |

**Client 端点：**

| 端点 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | Gateway 健康检查（每 30s） |
| `/task-result` | POST | Gateway 推送 Core 任务结果 |
| `/command` | POST | Gateway 管理指令（stop/ping） |

**设计决策：** Gateway 不对外提供任何 API。TUI 直连 Core 的 HTTP/WebSocket，不经过 Gateway。Atom Neo 定位为单机工具，无需对外暴露 HTTP API，因此 Gateway 不需要 JWT / 速率限制 / 反向代理等机制。

## 3. 消息流

```
1. 用户 → Telegram API → Client 接收 (webhook/polling)
2. Client → POST /gateway/inbound (Secret) → Gateway
3. Gateway → POST /api/tasks → Core
4. Gateway → GET /api/tasks/:id (轮询) → Core
5. Gateway → POST /task-result (Secret) → Client
6. Client → Telegram API (sendMessage) → 用户
```

### Inbound 消息格式

```jsonc
// POST /gateway/inbound
// Header: X-Gateway-Secret: <secret>
{
  "type": "message",
  "platform": "telegram",
  "platformUserId": "123456789",
  "data": {
    "text": "帮我查一下天气"
  }
}
```

### Task Result 推送格式

```jsonc
// POST /task-result (Gateway → Client)
// Header: X-Gateway-Secret: <secret>
{
  "taskId": "task-abc123",
  "platformUserId": "123456789",
  "result": {
    "output": "今天北京晴，22°C",
    "responseText": "今天北京晴，22°C"
  }
}
```

## 4. Secret 机制

| 时机 | 行为 |
|------|------|
| Gateway 启动 | 对每个 Client 生成 `crypto.randomUUID()` 作为 secret |
| 启动 Client | 通过 `--secret <uuid>` 传入 |
| 通讯 | Client 每次 HTTP 调用都带 `X-Gateway-Secret` Header |
| 崩溃重启 | Gateway 自动生成新 secret，旧 secret 立即失效 |

Secret 使用 timing-safe 比较，仅存储于 Gateway 内存。设计要求 Secret 与 Client 进程生命周期绑定；异常退出/重启路径现已撤销旧 Secret；验收记录见 [验收记录](../records/startup-validation.md)。

## 5. Client Manager / ProcessSupervisor

`ClientManager` 保留原有公开 API（`startAll/stopAll/start/stop/list/getBySecret/getById`），内部为每个 Client 创建一个 `ProcessSupervisor`。状态机是进程生命周期的唯一来源；启动、停止、异常退出、健康失败和重启计时器不再各自维护并行状态。

### 5.1 进程状态机

```text
idle --start--> starting --ready--> running --stop--> stopping --exit--> idle
                     |                  |
                     +--exit/error-----> failed --timer(desired)--> starting
running --health_failed--> failed --timer(desired)--> starting
failed --stop/give_up--> idle
```

| 状态 | 含义 |
|---|---|
| `idle` | 无进程、无重启计时器；`desired=false` |
| `starting` | 已 spawn，等待 `/health` 就绪（100ms 轮询，10s 超时） |
| `running` | 就绪；每 30s 健康检查 |
| `stopping` | 手动停止或强杀中，禁止重启 |
| `failed` | 异常退出/健康失败/启动失败；按策略等待重启或 give_up |

所有 spawn/stop/restart 操作通过 supervisor 内部队列串行。手动 `stop` 会立即清除重启计时器并撤销 secret；`stopAll` 先清除期望状态和所有计时器，再并行停止，结束后不会再 spawn。

### 5.2 启动与重启策略

```typescript
// 生产默认值集中在 client-manager/runtime.ts
const secret = generateSecret();
const port = config.clientPortRangeStart + clientIndex;
spawnProcess([
  binary,
  "--secret", secret,
  "--port", String(port),
  "--gateway-url", `http://127.0.0.1:${config.port}`,
  ...userArgs,
], { onExit: (code, signal, error) => supervisor.onExit(code, signal, error) });
```

- 重启上限 5 次，退避 `1s * 2^attempt`，上限 30s。
- 异常退出和健康检查失败共用同一 `failed → starting` 重启入口；达到上限后 give_up 并记录 `client restart limit reached`。
- 进程持续健康运行 ≥60s 后重置重启计数。
- 手动 stop 不会被旧 exit 回调或旧 timer 复活。

### 5.3 生命周期

```
Gateway 启动
  ├── 读取 config.gateway.clients[]
  ├── 对每个 client:
  │     ├── ProcessSupervisor 生成 secret + 使用分配端口
  │     ├── spawnProcess([二进制, "--secret", secret, "--port", port])
  │     └── 等待 Client HTTP server 就绪
  │
  └── 运行中:
        ├── 心跳: 每 30s GET /health
        ├── 健康失败 → 停止当前进程 → 按重启策略重启 (新 secret)
        ├── 进程异常退出 → 按重启策略重启 (新 secret)
        └── 收到 inbound → 轮询 Core → 推送 result

Gateway 关闭
  ├── POST /command {"action":"stop"} → Client
  └── handle.stop(false) → ClientManager.stopAll → handle.stop(true)
```

> **行为变化（S11-E）**：健康检查失败过去只记录日志；现在进入与异常退出相同的重启策略。路由、鉴权、状态码、端口/secret 规则、重启上限与退避保持不变。
>
> 测试通过 `client-manager/runtime.ts` 注入 fake spawn/fetch/now/timer，不启动真实子进程。

## 6. Client 二进制规范

每个 Client 是一个独立可执行文件，必须满足以下契约：

- **参数**: `--secret <uuid> --port <number> --gateway-url <url>`
- **HTTP Server**: 监听 `127.0.0.1:{port}`
- **端点实现**:
  - `GET /health` → `{ "ok": true }`
  - `POST /task-result` → 接收 Core 任务结果（需 Secret 验证）
  - `POST /command` → 接收管理指令（需 Secret 验证）
- **平台通讯**: 负责与外部平台（Telegram/WeChat）的所有 API 交互
- **将用户消息转发到**: `POST {gatewayUrl}/gateway/inbound` (带 Secret Header)
- **退出码**: 0 = 正常退出

## 7. 配置

```jsonc
// config.json
{
  "gateway": {
    "port": 3000,
    "clients": [
      {
        "id": "telegram-bot",
        "platform": "telegram",
        "binary": "/home/user/bots/telegram-bot",
        "clientArgs": {
          "bot-token": "123456:ABC-DEF...",
          "mode": "longpoll"
        },
        "stdio": "inherit"
      }
    ]
  }
}
```

**`clientArgs` 字段说明：**
- key 必须与 client 的 CLI 参数名完全一致（kebab-case）
- Gateway 保留 `secret`、`port`、`gateway-url` 三个内部参数，不允许覆盖
- 所有值必须为字符串类型

**`stdio` 字段说明：**
- 控制 Client 子进程 stdout/stderr 的处理方式
- `"inherit"`（默认）：输出到 Gateway 的 stdout/stderr，便于开发调试
- `"ignore"`：丢弃 Client 输出，减少生产环境日志噪音
- 注意：**不是** Client 的 CLI 参数，属于 Gateway 内部进程管理配置

环境变量：`GATEWAY_PORT`, `CORE_URL`；HTTP 传输选择使用 `ATOM_HTTP_RUNTIME`（`bun` / `node`）。

## 8. 文件

```
src/packages/gateway/
  src/
    index.ts                        barrel exports
    server.ts                       HTTP Server + 路由分发 + 消息中转
    server.test.ts                  HttpServer / logger 注入测试
    config.ts                       Gateway 配置
    auth/
      secret.ts                     Secret 生成与验证
    client-manager/
      README.md                     目录摘要与生命周期说明
      index.ts                      ClientManager facade
      runtime.ts                    spawn/fetch/now/timer 生产默认值
      process-state.ts              纯进程状态机
      restart-policy.ts             重启上限/退避/reset
      health-probe.ts               健康探测（200/非 2xx/超时/网络）
      process-supervisor.ts         每 Client 的进程生命周期
      test-helpers.ts               fake runtime/process/clock

clients/
  telegram-bot/
    src/main.ts                     Telegram Bot Client 参考实现
    package.json
```

## 9. 相关文档

| 文档 | 说明 |
|------|------|
| [architecture.md](../overview/architecture.md) | Gateway 在系统架构中的位置 |
| [protocol.md](./protocol.md) | WebSocket 事件协议与 HTTP API |
| [bootstrap.md](../overview/bootstrap.md) | Gateway 启动顺序 |
| [configuration.md](../subsystems/configuration.md) | Gateway 配置项 (port, clients) |
