# Telegram Bot Client

Atom Neo 的 Telegram 平台接入实现。

## 功能

- 从 Telegram Bot API 接收用户消息（支持 long polling 和 webhook 两种模式）
- 将消息转发到 Atom Neo Gateway
- 接收 Gateway 推送的任务结果并回复到 Telegram
- 自动处理消息分片（4096 字符上限）、429 限流退避、错误恢复

## 构建

```bash
bun run build
# 产出二进制文件：./bin/telegram-bot
```

Client 根目录的 `manifest.json` 声明运行时入口：发行包使用 `entry.production`（`./bin/telegram-bot`），开发目录使用 `entry.development`（`bun run src/main.ts`）。

## 运行

通常由 Gateway 自动拉起，无需手动启动。手动调试：

```bash
# Long Polling（默认）
./bin/telegram-bot \
  --secret <uuid> \
  --port 4200 \
  --gateway-url http://127.0.0.1:3000 \
  --bot-token <your-bot-token>

# Webhook 模式
./bin/telegram-bot \
  --secret <uuid> \
  --port 4200 \
  --gateway-url http://127.0.0.1:3000 \
  --bot-token <your-bot-token> \
  --mode webhook \
  --webhook-url https://bot.example.com/tg \
  --webhook-port 8443 \
  --webhook-secret <persistent-secret>
```

## 配置（推荐方式）

通过 Atom Neo 的 `config.json` 集中管理：

```jsonc
{
  "gateway": {
    "clients": [{
      "id": "telegram-main",
      "package": { "id": "telegram-bot", "version": "0.1.0" },
      "clientArgs": { "mode": "longpoll" },
      "credentials": {
        "bot-token": "ATOM_CLIENT_TELEGRAM_MAIN_BOT_TOKEN"
      }
    }, {
      "id": "telegram-dev",
      "directory": "/absolute/path/to/clients/telegram-bot",
      "clientArgs": { "mode": "longpoll" },
      "credentials": {
        "bot-token": "ATOM_CLIENT_TELEGRAM_DEV_BOT_TOKEN"
      }
    }]
  }
}
```

Token 值只写 sandbox `.env`，例如 `ATOM_CLIENT_TELEGRAM_MAIN_BOT_TOKEN=123456:ABC-DEF...`。`binary` 与实例级 `platform` 已不支持。

## 参数

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `--bot-token` | 是 | — | Telegram Bot Token |
| `--mode` | 否 | `longpoll` | `longpoll` 或 `webhook` |
| `--webhook-url` | webhook 必填 | — | Telegram 回调 URL |
| `--webhook-port` | 否 | `8443` | Webhook 监听端口 |
| `--webhook-host` | 否 | `127.0.0.1` | Webhook 监听地址 |
| `--webhook-secret` | 否 | 自动生成 | Webhook 路径令牌 |

## 限制

- 仅支持私聊（`chat.type === "private"`）
- 仅支持文本消息
- 不支持编辑消息触发
- 不支持群聊（privacy mode 限制）

## 文档

完整设计文档见 [`docs/clients/telegram-bot.md`](../../docs/clients/telegram-bot.md)。
