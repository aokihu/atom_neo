import React from "react";
import type { DocPageProps } from "./shared";
import { PageHeader, CodeBlock, ComparisonTable } from "./shared";

export default function DocPage({ title, description, category }: DocPageProps) {
return <div className="doc-page"><PageHeader title={title} description={description} category={category} readTime={8} />
<h2>{"Gateway Client 控制模式（已实现，待验收）"}</h2>
<p>{"2026-09-12：本节代码已实现；测试和进程级验收等待用户指令。详见 [启动模式计划](../overview/startup-modes-plan.md)。"}</p>
<ComparisonTable headers={["入口", "职责"]} rows={[["--mode core-gateway", "启动 Core 与 Gateway Server，不启动 TUI"], ["--mode gateway --clients <client_name>", "控制已配置的指定 Client"], ["--mode gateway（省略 clients）", "控制全部配置 Clients"]]} />
<p>{"clients 使用配置 ID，空值不是全部。动作参数为必填 --action start|stop。控制命令为短时进程，Gateway 不在线则报错，不自动启动 Server。已运行 start、已停止 stop 幂等，全部操作报告逐项结果及失败退出码。"}</p>
<p>{"新增 POST /admin/clients 本机管理接口，与 /gateway/* 平台消息接口分开认证；平台 Client secret 没有管理权限。建议受限权限运行描述供控制命令发现 Gateway 地址及管理凭据；实例校验和清理归属遵循启动计划。"}</p>
<p>{"ClientManager 复用 spawn/stop，增加公开按 ID 操作、期望状态、可取消重启计时器与进程实例检查。手动停止不被重启回调复活；旧 secret 在退出/重启时撤销；退避失败次数不在每次 spawn 清零。Gateway.stop 必须等待 stopAll，失败启动回滚资源。启动就绪应检查健康，不把 spawn 成功等同 ready。"}</p>
<p>{"Gateway 向 Core 提交创建信息 initiator={type:gateway,clientId,platform}，身份取认证后的配置。现有 ID 规则暂不迁移；不同 Client 对已有会话的发起者冲突必须拒绝覆盖。"}</p>
<p>{"停止 Client 不取消 Core 已接受任务；投递失败沿用现有错误处理，不新增补投递队列。定时任务主动向平台发送结果不属于此项控制改造。"}</p>
<h2>{"1. 架构"}</h2>
<CodeBlock lang={""} code={"外部平台                   Client (子进程)              Gateway                     Core\n┌──────────┐   webhook  ┌──────────────────┐  HTTP  ┌─────────────────────┐  HTTP  ┌──────┐\n│ Telegram │───────────→│ Telegram Bot     │───────→│ /gateway/inbound    │───────→│      │\n│ API      │←───────────│ ├ HTTP Server     │←───────│ ├ Secret 验证        │←───────│ Core │\n└──────────┘  sendMsg   │ ├ 长轮询/Webhook  │        │ ├ Message → Task    │        │      │\n                        │ └ 平台逻辑        │        │ ├ Poll Task Result  │        │      │\n                        └──────────────────┘        │ └ Push Result→Client│        └──────┘"} />
<p>{"**原则：**"}</p>
<p>{"- Gateway **不感知**平台细节（Telegram API 格式、消息转换等）"}</p>
<p>{"- Client 负责**所有平台特定逻辑**（webhook 管理、消息收发、格式转换）"}</p>
<p>{"- Gateway 是 **Client ↔ Core** 的安全中转层"}</p>
<p>{"- Client 和 Gateway 之间通过 **HTTP API + Secret** 双向通信"}</p>
<p>{"- Gateway **仅监听 127.0.0.1**，仅供本机 Client 子进程访问"}</p>
<h2>{"2. 路由"}</h2>
<p>{"当前实现仅暴露一类路由，仅供 Client 子进程使用；新增管理接口见上节："}</p>
<ComparisonTable headers={["路由前缀", "验证方式", "用户", "用途"]} rows={[["`/gateway/*`", "`X-Gateway-Secret` Header", "Client 子进程", "消息中转"]]} />
<p>{"**Gateway 端点：**"}</p>
<ComparisonTable headers={["端点", "方法", "说明"]} rows={[["`/gateway/inbound`", "POST", "Client 将平台消息提交给 Gateway"], ["`/gateway/event`", "POST", "Client 上报平台连接状态事件"]]} />
<p>{"**Client 端点：**"}</p>
<ComparisonTable headers={["端点", "方法", "说明"]} rows={[["`/health`", "GET", "Gateway 健康检查（每 30s）"], ["`/task-result`", "POST", "Gateway 推送 Core 任务结果"], ["`/command`", "POST", "Gateway 管理指令（stop/ping）"]]} />
<p>{"**设计决策：** Gateway 不对外提供任何 API。TUI 直连 Core 的 HTTP/WebSocket，不经过 Gateway。Atom Neo 定位为单机工具，无需对外暴露 HTTP API，因此 Gateway 不需要 JWT / 速率限制 / 反向代理等机制。"}</p>
<h2>{"3. 消息流"}</h2>
<CodeBlock lang={""} code={"1. 用户 → Telegram API → Client 接收 (webhook/polling)\n2. Client → POST /gateway/inbound (Secret) → Gateway\n3. Gateway → POST /api/tasks → Core\n4. Gateway → GET /api/tasks/:id (轮询) → Core\n5. Gateway → POST /task-result (Secret) → Client\n6. Client → Telegram API (sendMessage) → 用户"} />
<h2>{"Inbound 消息格式"}</h2>
<CodeBlock lang={"jsonc"} code={"// POST /gateway/inbound\n// Header: X-Gateway-Secret: <secret>\n{\n  \"type\": \"message\",\n  \"platform\": \"telegram\",\n  \"platformUserId\": \"123456789\",\n  \"data\": {\n    \"text\": \"帮我查一下天气\"\n  }\n}"} />
<h2>{"Task Result 推送格式"}</h2>
<CodeBlock lang={"jsonc"} code={"// POST /task-result (Gateway → Client)\n// Header: X-Gateway-Secret: <secret>\n{\n  \"taskId\": \"task-abc123\",\n  \"platformUserId\": \"123456789\",\n  \"result\": {\n    \"output\": \"今天北京晴，22°C\",\n    \"responseText\": \"今天北京晴，22°C\"\n  }\n}"} />
<h2>{"4. Secret 机制"}</h2>
<ComparisonTable headers={["时机", "行为"]} rows={[["Gateway 启动", "对每个 Client 生成 `crypto.randomUUID()` 作为 secret"], ["启动 Client", "通过 `--secret <uuid>` 传入"], ["通讯", "Client 每次 HTTP 调用都带 `X-Gateway-Secret` Header"], ["崩溃重启", "Gateway 自动生成新 secret，旧 secret 立即失效"]]} />
<p>{"Secret 使用 timing-safe 比较，仅存储于 Gateway 内存。设计要求 Secret 与 Client 进程生命周期绑定；异常退出/重启路径现已撤销旧 Secret，等待验收。"}</p>
<h2>{"5. Client Manager"}</h2>
<h2>{"5.1 启动"}</h2>
<CodeBlock lang={"typescript"} code={"// Gateway 内部\nconst secret = crypto.randomUUID();\nconst port = allocatePort();\nconst proc = Bun.spawn(clientBinaryPath, [\n  \"--secret\", secret,\n  \"--port\", String(port),\n  \"--gateway-url\", `http://127.0.0.1:${config.port}`,\n], { onExit: () => restartClient(id) });"} />
<h2>{"5.2 生命周期"}</h2>
<CodeBlock lang={""} code={"Gateway 启动\n  ├── 读取 config.gateway.clients[]\n  ├── 对每个 client:\n  │     ├── 生成 secret + 分配端口\n  │     ├── Bun.spawn(二进制, [\"--secret\", secret, \"--port\", port])\n  │     └── 等待 Client HTTP server 就绪\n  │\n  └── 运行中:\n        ├── 心跳: 每 30s GET /health\n        ├── 进程异常退出 → 自动重启 (新 secret)\n        └── 收到 inbound → 轮询 Core → 推送 result\n\nGateway 关闭\n  ├── POST /command {\"action\":\"stop\"} → Client\n  └── server.stop()"} />
<h2>{"6. Client 二进制规范"}</h2>
<p>{"每个 Client 是一个独立可执行文件，必须满足以下契约："}</p>
<p>{"- **参数**: `--secret <uuid> --port <number> --gateway-url <url>`"}</p>
<p>{"- **HTTP Server**: 监听 `127.0.0.1:{port}`"}</p>
<p>{"- **端点实现**:"}</p>
<p>{"  - `GET /health` → `{ \"ok\": true }`"}</p>
<p>{"  - `POST /task-result` → 接收 Core 任务结果（需 Secret 验证）"}</p>
<p>{"  - `POST /command` → 接收管理指令（需 Secret 验证）"}</p>
<p>{"- **平台通讯**: 负责与外部平台（Telegram/WeChat）的所有 API 交互"}</p>
<p>{"- **将用户消息转发到**: `POST {gatewayUrl}/gateway/inbound` (带 Secret Header)"}</p>
<p>{"- **退出码**: 0 = 正常退出"}</p>
<h2>{"7. 配置"}</h2>
<CodeBlock lang={"jsonc"} code={"// config.json\n{\n  \"gateway\": {\n    \"port\": 3000,\n    \"clients\": [\n      {\n        \"id\": \"telegram-bot\",\n        \"platform\": \"telegram\",\n        \"binary\": \"/home/user/bots/telegram-bot\",\n        \"clientArgs\": {\n          \"bot-token\": \"123456:ABC-DEF...\",\n          \"mode\": \"longpoll\"\n        },\n        \"stdio\": \"inherit\"\n      }\n    ]\n  }\n}"} />
<p>{"**`clientArgs` 字段说明：**"}</p>
<p>{"- key 必须与 client 的 CLI 参数名完全一致（kebab-case）"}</p>
<p>{"- Gateway 保留 `secret`、`port`、`gateway-url` 三个内部参数，不允许覆盖"}</p>
<p>{"- 所有值必须为字符串类型"}</p>
<p>{"**`stdio` 字段说明：**"}</p>
<p>{"- 控制 Client 子进程 stdout/stderr 的处理方式"}</p>
<p>{"- `\"inherit\"`（默认）：输出到 Gateway 的 stdout/stderr，便于开发调试"}</p>
<p>{"- `\"ignore\"`：丢弃 Client 输出，减少生产环境日志噪音"}</p>
<p>{"- 注意：**不是** Client 的 CLI 参数，属于 Gateway 内部进程管理配置"}</p>
<p>{"环境变量：`GATEWAY_PORT`, `CORE_URL`"}</p>
<h2>{"8. 文件"}</h2>
<CodeBlock lang={""} code={"src/packages/gateway/\n  src/\n    index.ts                        barrel exports\n    server.ts                       HTTP Server + 路由分发 + 消息中转\n    config.ts                       Gateway 配置\n    auth/\n      secret.ts                     Secret 生成与验证\n    client-manager/\n      index.ts                      Client 子进程管理器\n\nclients/\n  telegram-bot/\n    src/main.ts                     Telegram Bot Client 参考实现\n    package.json"} />
<h2>{"9. 相关文档"}</h2>
<ComparisonTable headers={["文档", "说明"]} rows={[["[architecture.md](../overview/architecture.md)", "Gateway 在系统架构中的位置"], ["[protocol.md](./protocol.md)", "WebSocket 事件协议与 HTTP API"], ["[bootstrap.md](../overview/bootstrap.md)", "Gateway 启动顺序"], ["[configuration.md](../subsystems/configuration.md)", "Gateway 配置项 (port, clients)"]]} />
</div>;
}
