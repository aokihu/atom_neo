# Gateway — 外部通讯界面层

> **Purpose**: Gateway 是 Atom Neo 的外部通讯界面层。通过管理平台 Client 子进程，将微信、Telegram 等外部平台的消息标准化后路由到 Core 引擎。

## 1. 架构

```
外部平台/用户               Gateway                         Core
┌──────────────┐         ┌──────────────────────┐       ┌──────┐
│ WeChat       │  spawn  │ Client Manager       │       │      │
│ Client (子进程)│←──────→│ ├ Token 随机生成      │       │      │
│              │ stdio   │ ├ 生命周期(启/停/重启) │       │      │
├──────────────┤  JSONL  │ └ 健康监控            │       │      │
│ Telegram     │  spawn  │                      │─────→│ Core │
│ Client (子进程)│←──────→│ ┌──────────────────┐ │       │      │
├──────────────┤         │ │ Message Router    │ │       │      │
│ TUI /        │ JWT     │ │ Client ↔ Core     │ │       │      │
│ HTTP API     │───────→│ └──────────────────┘ │       │      │
│ (外部用户)    │ /api/*  │                      │       │      │
└──────────────┘         └──────────────────────┘       └──────┘
```

## 2. 路由分离

Gateway 暴露两类路由，独立验证：

| 路由前缀 | 验证方式 | 用户 | 用途 |
|---------|---------|------|------|
| `/api/*` | `Authorization: Bearer <JWT>` | TUI / 外部 HTTP 客户端 | 任务提交、状态查询、WebSocket |
| `/gateway/*` | 内部 Client Token | Client 子进程 | 状态上报、管理 API |

### 2.1 `/api/*` — JWT 验证

外部用户（TUI、HTTP API 调用者）通过 JWT Bearer Token 访问 Gateway。

```
Client → Gateway:  POST /api/tasks
                   Authorization: Bearer eyJhbG...
                   {"sessionId": "...", "data": {"text": "..."}}

Gateway → Core:    转发经过验证的请求
```

JWT 包含：
- `sub` — 用户标识
- `permissionLevel` — 权限等级
- `exp` — 过期时间

### 2.2 `/gateway/*` — Client Token 验证

内部 Client 子进程通过 Gateway 启动时分配的一次性随机 Token 进行身份验证。Token 仅存在于内存，每次 Client 重启自动轮换。

## 3. Client 子进程

### 3.1 启动

```typescript
// Gateway 内部
const token = crypto.randomUUID();
const proc = Bun.spawn(clientBinaryPath, ["--token", token], {
  stdin: "pipe",
  stdout: "pipe",
  stderr: "pipe",
});

// 记录 Client 信息
this.#clients.set(clientId, {
  proc,
  token,
  status: "starting",
  platform: "wechat",
  startedAt: Date.now(),
});
```

用户在 `config.json` 中配置 Client 二进制路径：

```jsonc
{
  "gateway": {
    "port": 3000,
    "jwtSecret": "...",
    "clients": [
      {
        "id": "wechat-bot",
        "platform": "wechat",
        "binary": "/home/user/bots/wechat-bot"
      },
      {
        "id": "telegram-bot",
        "platform": "telegram",
        "binary": "/home/user/bots/telegram-bot"
      }
    ]
  }
}
```

### 3.2 Token 机制

| 时机 | 行为 |
|------|------|
| 启动 | `crypto.randomUUID()` 生成新 token |
| 握手 | Client 通过 stdout 发送 token，Gateway 验证 |
| 崩溃重启 | 自动生成新 token，旧 token 立即失效 |
| 主动停止 | 清理 token，结束子进程 |

Token 仅存储于 Gateway 内存，不写入磁盘或日志。

### 3.3 通信协议 — JSONL over stdin/stdout

Gateway 与 Client 子进程通过进程管道通信，每行一条 JSON 消息。

**Client → Gateway (stdout)：**

```jsonl
{"type":"auth","token":"550e8400-e29b-41d4-a716-446655440000"}
{"type":"message","platform":"wechat","platformUserId":"user_123","data":{"text":"帮我查一下天气"}}
{"type":"status","status":"connected","platformUserId":"user_123"}
```

**Gateway → Client (stdin)：**

```jsonl
{"type":"auth_ok","sessionId":"sess-abc123"}
{"type":"response","sessionId":"sess-abc123","userId":"user_123","data":{"text":"今天北京晴，22°C"}}
{"type":"command","action":"stop"}
```

**消息类型：**

| type | 方向 | 说明 |
|------|------|------|
| `auth` | Client → Gateway | 握手：携带 token 进行身份验证 |
| `auth_ok` | Gateway → Client | 握手成功，返回分配的 sessionId |
| `auth_fail` | Gateway → Client | 握手失败，连接将被关闭 |
| `message` | Client → Gateway | 来自外部平台的用户消息 |
| `response` | Gateway → Client | Core 处理完成后的回复 |
| `status` | 双向 | 平台连接状态（connected/disconnected） |
| `error` | 双向 | 错误信息 |
| `command` | Gateway → Client | Gateway 指令（stop/restart/ping） |
| `pong` | Client → Gateway | 心跳响应 |

### 3.4 生命周期

```
Gateway 启动
  ├── 读取 config.clients[]
  ├── 对每个 client:
  │     ├── 生成 token
  │     ├── Bun.spawn(client.binary, ["--token", token])
  │     ├── 等待 stdout 握手: {"type":"auth","token":"..."}
  │     ├── 验证通过 → 发送 {"type":"auth_ok","sessionId":"..."}
  │     └── 进入消息循环
  │
  └── 运行中:
        ├── 心跳检测: 每 30s 发送 {"type":"command","action":"ping"}
        ├── 超时无响应 → SIGTERM → 自动重启(新token)
        └── 进程异常退出 → 自动重启(新token)

Gateway 关闭
  ├── 对每个 client:
  │     ├── stdin: {"type":"command","action":"stop"}
  │     ├── 等待 5s
  │     └── SIGKILL
  └── 清理 token 注册表
```

## 4. 消息路由

```
Client → stdout: {"type":"message","platform":"wechat","userId":"u1","data":{...}}
  │
  ▼ Gateway MessageRouter
  │
  ├── 查找或创建 session: sessionStore.get(platform + ":" + userId)
  ├── 标准化为 TaskPayload
  └── POST /api/tasks → Core
  
Core 处理完成 → WebSocket transport.completed
  │
  ▼ Gateway
  │
  └── Client stdin: {"type":"response","userId":"u1","data":{"text":"回复内容"}}
```

## 5. Client 二进制规范

每个 Client 是一个独立可执行文件，必须满足以下契约：

- **参数**: 接受 `--token <uuid>` 作为唯一 CLI 参数
- **stdin**: 读取来自 Gateway 的 JSONL 消息
- **stdout**: 写入发往 Gateway 的 JSONL 消息
- **stderr**: 仅用于日志输出（Gateway 捕获但不解析）
- **启动后首个消息**: 必须发送 `{"type":"auth","token":"..."}` 完成握手
- **退出码**: 0 = 正常退出，非 0 = 异常
- **信号处理**: 接收 SIGTERM 后优雅关闭（5s 内退出）

Client 负责与外部平台的**所有**平台特定逻辑（API 调用、消息格式转换、连接保活），Gateway 不感知平台细节。

## 6. 文件

```
src/packages/gateway/
  src/
    index.ts                        barrel exports
    server.ts                       HTTP Server + 路由分发
    config.ts                       config.json 加载
    auth/
      jwt.ts                        JWT 签发与验证
    ratelimit/
      limiter.ts                    滑动窗口速率限制
    permissions/
      checker.ts                    权限等级比较
    proxy/
      core-proxy.ts                 HTTP 反向代理到 Core
    client-manager/
      index.ts                      Client 子进程管理器（待实现）
      protocol.ts                   JSONL 消息解析（待实现）
    ---
```

## 7. 相关文档

| 文档 | 说明 |
|------|------|
| [architecture.md](../overview/architecture.md) | Gateway 在系统架构中的位置 |
| [protocol.md](./protocol.md) | WebSocket 事件协议与 HTTP API |
| [bootstrap.md](../overview/bootstrap.md) | Gateway 启动顺序 |
| [configuration.md](../subsystems/configuration.md) | Gateway 配置项 (jwtSecret, port, clients) |
