# Gateway — 外部通讯界面层

> **Purpose**: Gateway 是 Atom Neo 的外部通讯界面层。通过管理平台 Client 子进程，将微信、Telegram 等外部平台的消息标准化后路由到 Core 引擎。

## 1. 架构

```
外部平台                   Client (子进程)              Gateway                     Core
┌──────────┐   webhook  ┌──────────────────┐  HTTP  ┌─────────────────────┐  HTTP  ┌──────┐
│ Telegram │───────────→│ Telegram Bot     │───────→│ /gateway/inbound    │───────→│      │
│ API      │←───────────│ ├ HTTP Server     │←───────│ ├ Secret 验证        │←───────│ Core │
└──────────┘  sendMsg   │ ├ 长轮询/Webhook  │        │ ├ Message → Task    │        │      │
                        │ └ 平台逻辑        │        │ ├ Poll Task Result  │        │      │
                        └──────────────────┘        │ └ Push Result→Client│        └──────┘
                                                     │                     │
                                                     │ /api/* (JWT)        │
                        外部 HTTP 用户 ─────────────→│ 代理到 Core          │
```

**原则：**
- Gateway **不感知**平台细节（Telegram API 格式、消息转换等）
- Client 负责**所有平台特定逻辑**（webhook 管理、消息收发、格式转换）
- Gateway 是 **Client ↔ Core** 的安全中转层
- Client 和 Gateway 之间通过 **HTTP API + Secret** 双向通信

## 2. 路由分离

Gateway 暴露两类路由，独立验证：

| 路由前缀 | 验证方式 | 用户 | 用途 |
|---------|---------|------|------|
| `/api/*` | `Authorization: Bearer <JWT>` | TUI / 外部 HTTP 客户端 | 代理到 Core |
| `/gateway/*` | `X-Gateway-Secret` Header | Client 子进程 | 消息中转 |

### 2.1 `/api/*` — JWT 验证

外部用户（TUI、HTTP API 调用者）通过 JWT Bearer Token 访问 Gateway，Gateway 代理请求到 Core。

### 2.2 `/gateway/*` — Secret 验证

内部 Client 子进程通过 HTTP Header `X-Gateway-Secret` 进行身份验证。

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

Secret 使用 timing-safe 比较，仅存储于 Gateway 内存。

## 5. Client Manager

### 5.1 启动

```typescript
// Gateway 内部
const secret = crypto.randomUUID();
const port = allocatePort();
const proc = Bun.spawn(clientBinaryPath, [
  "--secret", secret,
  "--port", String(port),
  "--gateway-url", `http://127.0.0.1:${config.port}`,
], { onExit: () => restartClient(id) });
```

### 5.2 生命周期

```
Gateway 启动
  ├── 读取 config.gateway.clients[]
  ├── 对每个 client:
  │     ├── 生成 secret + 分配端口
  │     ├── Bun.spawn(二进制, ["--secret", secret, "--port", port])
  │     └── 等待 Client HTTP server 就绪
  │
  └── 运行中:
        ├── 心跳: 每 30s GET /health
        ├── 进程异常退出 → 自动重启 (新 secret)
        └── 收到 inbound → 轮询 Core → 推送 result

Gateway 关闭
  ├── POST /command {"action":"stop"} → Client
  └── server.stop()
```

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
    "jwtSecret": "change-me-minimum-16-chars",
    "clients": [
      {
        "id": "telegram-bot",
        "platform": "telegram",
        "binary": "/home/user/bots/telegram-bot"
      }
    ]
  }
}
```

环境变量：`GATEWAY_PORT`, `CORE_URL`, `JWT_SECRET`

## 8. 文件

```
src/packages/gateway/
  src/
    index.ts                        barrel exports
    server.ts                       HTTP Server + 路由分发 + 消息中转
    config.ts                       Gateway 配置
    auth/
      jwt.ts                        JWT 签发与验证
      secret.ts                     Secret 生成与验证
    ratelimit/
      limiter.ts                    滑动窗口速率限制
    permissions/
      checker.ts                    权限等级比较
    proxy/
      core-proxy.ts                 HTTP 反向代理到 Core
    client-manager/
      index.ts                      Client 子进程管理器

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
| [configuration.md](../subsystems/configuration.md) | Gateway 配置项 (jwtSecret, port, clients) |
