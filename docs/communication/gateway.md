# Gateway — 平台 Client 中转层

> **Purpose**: Gateway 是 Atom Neo 的平台 Client 中转层。通过管理平台 Client 子进程，将微信、Telegram 等外部平台的消息标准化后路由到 Core 引擎。

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

## 2. 路由

Gateway 仅暴露一类路由，仅供 Client 子进程使用：

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

Secret 使用 timing-safe 比较，仅存储于 Gateway 内存。Secret 与 Client 进程生命周期绑定，进程死则 Secret 死。

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

环境变量：`GATEWAY_PORT`, `CORE_URL`

## 8. 文件

```
src/packages/gateway/
  src/
    index.ts                        barrel exports
    server.ts                       HTTP Server + 路由分发 + 消息中转
    config.ts                       Gateway 配置
    auth/
      secret.ts                     Secret 生成与验证
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
| [configuration.md](../subsystems/configuration.md) | Gateway 配置项 (port, clients) |
