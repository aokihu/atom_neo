# Telegram Bot Client — 平台接入实现

> **Purpose**: Telegram Bot Client 是 Atom Neo 的第一个平台接入参考实现。它负责与 Telegram Bot API 交互，将用户消息标准化后转发到 Gateway，并将 Core 的回复发送回用户。

## 1. 架构位置

```
用户 (Telegram App)
    │
    │ HTTPS
    ▼
Telegram Bot API (api.telegram.org)
    │
    │ long polling / webhook
    ▼
Telegram Bot Client (本进程)
    │ HTTP + X-Gateway-Secret
    ▼
Gateway (127.0.0.1:3000)
    │ HTTP
    ▼
Core (127.0.0.1:3100)
```

## 2. 启动参数

Client 通过 CLI 参数接收所有配置。Gateway 在 `config.json` 中通过 `clientArgs` 字段集中管理这些参数。

### 2.1 内部参数（Gateway 注入，用户不应手动指定）

| 参数 | 类型 | 说明 |
|------|------|------|
| `--secret <uuid>` | string | Gateway 生成的鉴权令牌，用于 `/task-result` `/command` 端点 |
| `--port <number>` | number | Client HTTP Server 监听端口（管理端点） |
| `--gateway-url <url>` | string | Gateway 的 URL，用于提交 inbound 消息 |

### 2.2 用户参数（通过 `config.json` 的 `clientArgs` 透传）

| 参数 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| `--bot-token <token>` | string | 是 | — | Telegram Bot Token（BotFather 颁发） |
| `--mode <mode>` | `longpoll` \| `webhook` | 否 | `longpoll` | 消息获取模式 |
| `--webhook-url <url>` | string | webhook 模式必填 | — | Telegram 回调 URL（不含路径令牌） |
| `--webhook-port <port>` | number | 否 | `8443` | Webhook 监听端口 |
| `--webhook-host <ip>` | string | 否 | `127.0.0.1` | Webhook 监听地址 |
| `--webhook-secret <token>` | string | 否 | 启动时生成 | Webhook 路径令牌，持久化可避免 Cloudflare 配置变更 |

### 2.3 参数示例

```bash
# Long Polling（默认，零配置）
./telegram-bot \
  --secret 550e8400-e29b-41d4-a716-446655440000 \
  --port 4200 \
  --gateway-url http://127.0.0.1:3000 \
  --bot-token 123456:ABC-DEF...

# Webhook（配合 Cloudflare Tunnel）
./telegram-bot \
  --secret 550e8400-e29b-41d4-a716-446655440000 \
  --port 4200 \
  --gateway-url http://127.0.0.1:3000 \
  --bot-token 123456:ABC-DEF... \
  --mode webhook \
  --webhook-url https://bot.your-domain.com/tg \
  --webhook-port 8443 \
  --webhook-secret your-persistent-secret
```

## 3. Gateway 配置

在 `config.json` 中通过 `clientArgs` 字段透传所有用户参数：

```jsonc
{
  "gateway": {
    "port": 3000,
    "clients": [{
      "id": "telegram-bot",
      "platform": "telegram",
      "binary": "/path/to/telegram-bot",
      "clientArgs": {
        "bot-token": "123456:ABC-DEF...",
        "mode": "longpoll"
        // 或：
        // "mode": "webhook",
        // "webhook-url": "https://bot.your-domain.com/tg",
        // "webhook-port": "8443",
        // "webhook-secret": "your-persistent-secret"
      }
    }]
  }
}
```

**规则：**
- `clientArgs` 的 key 必须与 client CLI 参数名完全一致（kebab-case）
- Gateway 保留 `secret`、`port`、`gateway-url` 三个内部参数，不允许在 `clientArgs` 中覆盖
- 所有值必须为字符串类型

## 4. 两种模式对比

| 维度 | Long Polling | Webhook |
|------|--------------|---------|
| **网络要求** | 能访问 api.telegram.org | 需要公网可达的 HTTPS 端点 |
| **域名/证书** | 不需要 | 需要（或 Cloudflare Tunnel） |
| **配置复杂度** | 零配置 | 需要配置 webhook URL + secret |
| **实时性** | 与 webhook 等同（timeout=30s） | 实时 |
| **适用场景** | 开发、家庭/办公网络 | 云服务器、有 Cloudflare 等基础设施 |
| **互斥性** | 与 webhook 互斥（自动 `deleteWebhook`） | 与 long polling 互斥（自动 `setWebhook`） |

### 4.1 为什么默认 Long Polling？

Atom Neo 定位为**单机工具**，大多数用户运行在没有公网 IP/域名的环境中。Long Polling 只需要一个 Bot Token 即可工作，而 Webhook 需要额外的公网基础设施。文档化此决策可防止未来误改。

### 4.2 Cloudflare Tunnel 部署 Webhook

如果你选择 webhook 模式，推荐使用 Cloudflare Tunnel：

```yaml
# cloudflared config.yml
tunnel: <tunnel-id>
credentials-file: /path/to/credentials.json
ingress:
  - hostname: bot.your-domain.com
    service: http://127.0.0.1:8443
  - service: http_status:404
```

启动 cloudflared 后，Telegram 的 HTTPS 请求会经 Cloudflare Edge 回源到本机的 8443 端口。

## 5. 消息流

### 5.1 入站（用户 → Core）

```
1. Telegram API 推送 update（poll 或 webhook）
2. Client 解析 update.message
3. 过滤：仅处理 chat.type === "private" 且包含 text 的消息
4. POST {gatewayUrl}/gateway/inbound
   Header: X-Gateway-Secret: {secret}
   Body: {
     type: "message",
     platform: "telegram",
     platformUserId: String(chat.id),
     data: { text: message.text }
   }
5. Gateway 转发到 Core /api/tasks
6. Gateway 轮询任务结果
7. Gateway POST /task-result 到 Client
8. Client 调用 sendMessage 回复用户
```

### 5.2 消息分片

Telegram `sendMessage` 限制单条消息 4096 字符。Client 自动将长回复按 `\n` 边界切分为多条消息：

```
原始文本（5000 字符）
  ├── 分片 1（约 4096 字符，在最后一个 \n 处截断）
  ├── 分片 2（剩余 904 字符）
  └── 依次发送
```

仅第一条消息携带 `reply_parameters.message_id`（关联到用户原消息）。

## 6. 错误处理

### 6.1 Telegram API 错误

| 错误码 | 含义 | Client 行为 |
|--------|------|-------------|
| 400 | Bad Request（参数错误/文本超长） | 记录日志，跳过该消息 |
| 401 | Unauthorized（token 失效） | **立即退出进程**（退出码 1），让 Gateway 重启策略接管 |
| 403 | Forbidden（被用户拉黑） | 记录日志，跳过该用户 |
| 409 | Conflict（另一个实例在 polling） | **立即退出进程**（退出码 1） |
| 429 | Too Many Requests | 按 `retry_after` 秒数退避，无则指数退避（1s → 2s → ... → 30s 上限） |
| 5xx | Telegram 服务端错误 | 指数退避后重试 |

### 6.2 网络错误

- 连接超时/重置：指数退避后重试（与 429 共用退避逻辑）
- 连续失败超过 5 次：记录错误日志，继续尝试（不退出）

## 7. 安全设计

### 7.1 Secret 双重防护（Webhook 模式）

```
Telegram → Cloudflare Edge → 源站
                │
                ├── URL 路径：/tg/{webhook-secret}
                └── Header：X-Telegram-Bot-Api-Secret-Token: {webhook-secret}
```

双重防护确保即使路径泄露，没有 Header 也无法伪造请求。

### 7.2 Timing-Safe 比较

Client 验证 Gateway 的 `X-Gateway-Secret` 时使用异或逐字节比较，防止时序侧信道攻击。

### 7.3 进程隔离

- Client 是 Gateway 的子进程，崩溃后 Gateway 自动重启（生成新 secret）
- Secret 仅存在于 Gateway 和 Client 的内存中，不落盘

## 8. 限制与边界

| 限制 | 说明 |
|------|------|
| 仅私聊 | `chat.type !== "private"` 的消息被忽略，回复"请私聊使用" |
| 仅文本 | 非文本消息（photo/sticker/voice 等）回复"目前仅支持文本消息" |
| 忽略编辑 | `edited_message` 不处理，避免重复触发任务 |
| 无群聊 | 群聊需要关闭 privacy mode 或 @bot，当前版本不支持 |
| 无媒体 | 不处理 photo/document/voice 等附件 |
| 无内联键盘 | 不生成 reply_markup |

## 9. 相关文档

| 文档 | 说明 |
|------|------|
| [gateway.md](../communication/gateway.md) | Gateway 架构与 Secret 机制 |
| [protocol.md](../communication/protocol.md) | WebSocket 事件协议 |
| [configuration.md](../subsystems/configuration.md) | 配置加载与 `clientArgs` 字段 |
