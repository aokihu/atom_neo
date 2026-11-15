# Gateway — 平台 Client 中转层

> **Purpose**: Gateway 是 Atom Neo 的平台 Client 中转层。通过管理平台 Client 子进程，将微信、Telegram 等外部平台的消息标准化后路由到 Core 引擎。

## 接入改进（2026-11-14，M1 已实施）

新增 [接入与发行规划](./gateway-client-design.md) 与独立 [开发计划](./gateway-development-plan.md)：标准 Client 发行包安装、根目录 `manifest.json`、Chrome 式开发目录加载/手动重载、配置向导和实例状态诊断。

M1（G0+G1）已落地：实例配置只接受 `package` / `directory` 二选一，`binary` / 实例级 `platform` 已移除并明确拒绝；manifest v1 解析、入口选择、`ResolvedClientConfig` 统一启动描述、凭据引用注入与实例凭据隔离已接入现有 `ClientManager` / `ProcessSupervisor`。

M2（G2）已落地本地包闭环：Telegram manifest、`packClient`（manifest + `bin/**` 白名单、target 注入、敏感文件排除）、安全 `installClient`（路径/链接校验、临时目录、失败回滚）、`packages.json` registry（`sha256` 幂等/冲突）、离线实例配置 API 与 config-tui 首次实例表单。M2.1 硬化了 gateway 端口延迟绑定与 registry 跨进程锁。

M3a（G3）已落地动态管理与重载：`ClientManager` 动态 register/remove/reload、活动端口集合、GET 状态/诊断、POST reload、drain 503/409、Telegram 503/429 offset 语义、`atom gateway` CLI 与离线/在线处理器。

M3b（G4）已落地管理与诊断 UI：`GatewayModal` 显示实例来源（package 版本或 directory）、supervisor 状态/端口/平台、最近错误；操作面板提供 start/stop/reload、check、diagnostics/logs、编辑、install、load、pack。`GatewayInstanceForm` 支持编辑模式，secret 使用固定宽度遮罩输入，空白 secret 表示保持已配置值；enum/default 与 resolver 契约一致。启动菜单新增 install/load/manage/pack，history 只记录 sandbox/target/id/out。`atom gateway load --id <id>` 允许同一目录创建不同实例，省略时仍使用 `manifest.id`。

M3b 初审修复：`POST /admin/clients {action:"register",clientId}` 通过现有 resolver 重新读取 config/.env/registry/manifest 后动态 `cm.register`，不自动启动；重复登记返回 409，其他解析/登记失败返回 400，不影响已有实例。`gateway load` 在 Gateway 在线时写 config 后调用 register，离线时保持 `saved, not started`；JSON 输出区分 `saved/registered/offline`。UI admin 请求统一 5s 超时，client 列表 key 使用 `client:` 前缀避免与 refresh/install/load/pack/port/back 固定动作冲突。注册仍要求配置已可解析：required 字段或 required secret 缺失时返回 400，config 保留但需补齐后再次 load 或重启登记。

`--mode` 控制入口继续保留。`/health` 只证明 Client 本机 HTTP 就绪，平台凭据检查与消息往返需要分别验证。UI 的进程状态只来自 supervisor/admin API，平台检查只来自 Client `/diagnostics`，不另建状态源；诊断仍由 Gateway 有界脱敏。

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

当前实现区分本机管理路由与平台 Client 路由：

| 路由前缀 | 验证方式 | 用户 | 用途 |
|---------|---------|------|------|
| `/gateway/*` | `X-Gateway-Secret` Header | Client 子进程 | 消息中转 |
| `/admin/clients`（GET） | 本机管理 Token | 本机控制命令 | 实例状态、来源/端口与诊断摘要 |
| `/admin/clients`（POST） | 本机管理 Token | 本机控制命令 | start/stop/reload/register，返回逐项结果 |
| `/admin/clients/:id/diagnostics`（GET） | 本机管理 Token | 本机检查/日志 | 本地诊断事件 + 可选 Client `/diagnostics` |

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

### 重载与 drain

- 每个实例维护 inbound 在途计数；`POST /admin/clients {action:"reload", clientId}` 只 drain 目标实例。
- drain 期间目标实例的 `/gateway/inbound` 返回 503 `{error:"Client busy"}`，其他实例不受影响。
- 默认 30s 内等待在途请求结束；超时返回 409 并保留旧进程。
- 成功后停止旧 supervisor（撤销 Secret/清 timer），用同一端口和 `desired` 状态创建新 supervisor；旧 exit 回调/restart timer 不影响新进程。
- Telegram Client 对 503/429 退避重试，不推进 update offset。

### 诊断

- `DiagnosticsStore` 每实例保留最近 50 条事件，阶段为 `install|config|process|platform|delivery`，输出前脱敏/截断。
- `GET /admin/clients/:id/diagnostics` 返回本地事件和 `client` 结果：Client `/diagnostics` 2xx → `ok`，404 → `unsupported`，不可达 → `unreachable`。
- Client `/diagnostics` 有界：最多 20 条 check；`name`/`detail` 各最多 200 字符，`at` 最多 64 字符；总序列化上限 8 KiB；只保留 `name|ok|at|detail`，未知字段丢弃，常见 Token/Secret/UUID 形态脱敏，非法 check 结构按 `unreachable` 处理。
- `/health` 只表示本机 HTTP 就绪；不能据此判定 Telegram Token 有效。真实消息往返仍需单独验证。
- `GET /diagnostics` 是 Client 可选协议；未实现时 Gateway 显示 `unsupported`。

## 4. Secret 机制

| 时机 | 行为 |
|------|------|
| Gateway 启动 | 对每个 Client 生成 `crypto.randomUUID()` 作为 secret |
| 启动 Client | 通过 `--secret <uuid>` 传入 |
| 通讯 | Client 每次 HTTP 调用都带 `X-Gateway-Secret` Header |
| 崩溃重启 | Gateway 自动生成新 secret，旧 secret 立即失效 |

Secret 使用 timing-safe 比较，仅存储于 Gateway 内存。设计要求 Secret 与 Client 进程生命周期绑定；异常退出/重启路径现已撤销旧 Secret；验收记录见 [验收记录](../records/startup-validation.md)。

## 5. Client Manager / ProcessSupervisor

`ClientManager` 提供 `register/remove/reload/status` 动态 API，并保留 `startAll/stopAll/start/stop/list/getBySecret/getById`；内部为每个 Client 创建一个 `ProcessSupervisor`，端口按活动集合分配。状态机是进程生命周期的唯一来源；启动、停止、异常退出、健康失败和重启计时器不再各自维护并行状态。`status()` 返回 secret-free 的 active 投影。

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
  ...resolved.command,
  "--secret", secret,
  "--port", String(port),
  "--gateway-url", `http://127.0.0.1:${config.port}`,
  ...buildClientArgs(resolved.clientArgs),
], {
  cwd: resolved.cwd,
  env: resolved.env,
  onExit: (code, signal, error) => supervisor.onExit(code, signal, error),
});
```

`resolved` 是 `client-package/resolver.ts` 产出的 `ResolvedClientConfig`：`command` 来自 manifest 的 production/development 入口，`cwd` 为 Client 根目录，`platform` 来自 manifest。凭据只注入目标实例；`env` 仍继承允许的父进程变量，但会过滤其他实例的 `ATOM_CLIENT_*` 与 `ATOM_ADMIN_TOKEN`。`binary` 与实例级 `platform` 不再是实例配置字段。

- 重启上限 5 次，退避 `1s * 2^attempt`，上限 30s。
- 异常退出和健康检查失败共用同一 `failed → starting` 重启入口；达到上限后 give_up 并记录 `client restart limit reached`。
- 进程持续健康运行 ≥60s 后重置重启计数。
- 手动 stop 不会被旧 exit 回调或旧 timer 复活。

### 5.3 生命周期

```
Gateway 启动
  ├── 读取 config.gateway.clients[]（package / directory）
  ├── resolver 读取 manifest.json → ResolvedClientConfig[]
  ├── 对每个 client:
  │     ├── ProcessSupervisor 生成 secret + 使用分配端口
  │     ├── spawnProcess([...entry, "--secret", secret, "--port", port], { cwd, env })
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

## 6. Client 程序规范

每个 Client 是一个独立程序（发行包或开发目录），根目录必须有 `manifest.json`，并满足以下契约：

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

M1 当前实现：实例配置只接受 `package` / `directory` 二选一，`binary` 与实例级 `platform` 已移除。旧 `binary` 配置在 schema 校验阶段被拒绝，错误信息提示改用 `package` 或 `directory`；不自动迁移。`platform`、启动命令与 cwd 均由 Client 根目录的 `manifest.json` 解析。

```jsonc
// config.json
{
  "gateway": {
    "port": 3000,
    "clients": [
      {
        "id": "telegram-main",
        "package": { "id": "telegram-bot", "version": "0.1.0" },
        "clientArgs": { "mode": "longpoll" },
        "credentials": {
          "bot-token": "ATOM_CLIENT_TELEGRAM_MAIN_BOT_TOKEN"
        },
        "stdio": "inherit"
      },
      {
        "id": "telegram-dev",
        "directory": "./clients/telegram-bot",
        "clientArgs": { "mode": "longpoll" },
        "credentials": {
          "bot-token": "ATOM_CLIENT_TELEGRAM_DEV_BOT_TOKEN"
        }
      }
    ]
  }
}
```

- `package` 引用已安装包；`directory` 引用开发目录。二者必须恰好出现一个。
- `directory` 可为绝对路径；相对路径在 Gateway 启动时相对 sandbox 根目录解析（`main.ts` 传入 `baseDir`）。G2 的 CLI/向导应优先写入绝对路径。
- `credentials` 只保存字段到 `.env` 变量名的引用，例如 `bot-token -> ATOM_CLIENT_TELEGRAM_MAIN_BOT_TOKEN`；启动时由 resolver 注入 manifest 声明的子进程变量（如 `TELEGRAM_BOT_TOKEN`）。
- 启动前校验 `manifest.config` 的 `required` 字段：secret 字段必须在 `credentials` 中有引用，非 secret 字段必须在 `clientArgs` 中有同名参数。可选非 secret 字段缺失时 resolver 应用 manifest `default`；`clientArgs` 必须满足 manifest `enum`，secret 字段不得进入 `clientArgs`。G2 配置表单仍负责预填和选择。
- 凭据只写 `.env`；实例写入入口为 shared `client-instance.ts`，使用 lockfile 与 `configRevision` 防止并发覆盖。Gateway 只读。

**`clientArgs` 字段说明：**
- key 必须与 client 的 CLI 参数名完全一致（kebab-case）
- Gateway 保留 `secret`、`port`、`gateway-url` 三个内部参数，不允许覆盖
- 所有值必须为字符串类型
- `credentials` 中的字段不进入普通 CLI 参数

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
    server.ts                       HTTP Server + 路由分发 + 消息中转/drain/reload/诊断
    server.test.ts                  HttpServer / logger 注入测试
    server.admin.test.ts            管理状态/诊断/reload/drain 测试
    config.ts                       Gateway 配置
    auth/
      secret.ts                     Secret 生成与验证
    client-package/
      README.md                     目录摘要与边界
      manifest.ts                   manifest v1 解析、严格校验、入口选择
      resolver.ts                   用户实例配置 → ResolvedClientConfig
      registry.ts                   packages.json 登记、sha256 幂等/冲突
      archive.ts                    tar.gz pack/install、目标与路径安全
      instance-config.ts            离线实例配置 API
    client-manager/
      README.md                     目录摘要与生命周期说明
      index.ts                      ClientManager facade
      runtime.ts                    spawn/fetch/now/timer 生产默认值
      process-state.ts              纯进程状态机
      restart-policy.ts             重启上限/退避/reset
      health-probe.ts               健康探测（200/非 2xx/超时/网络）
      process-supervisor.ts         每 Client 的进程生命周期
      process-termination.ts        优雅终止/强杀
      client-command.ts             命令/参数/spawn options/readiness
      diagnostics.ts                有界诊断事件 + Client /diagnostics
      test-helpers.ts               fake runtime/process/clock

src/bootstrap/
  cli.ts                            atom gateway 子命令解析（含 load --id）
  gateway-command.ts                离线/在线 gateway 处理器
  gateway-actions.ts                config-tui 安装/加载/打包命令注入
  runtime-file.ts                   复用 shared runtime 读取，发布/清理

src/packages/config-tui/src/
  gateway-status.ts                 admin 状态/诊断/动作/实例保存
  components/GatewayModal.tsx       实例列表、操作、诊断、安装/加载/打包
  components/GatewayInstanceForm.tsx manifest.config 表单与编辑模式
  components/SecretFieldInput.tsx   固定遮罩 secret 输入

clients/
  telegram-bot/
    src/main.ts                     Telegram Bot Client 参考实现
    src/gateway-client.ts           Gateway inbound 提交/非 2xx
    src/update-loop.ts              update offset/retry
    src/diagnostics.ts              Telegram getMe 诊断
    package.json
```

## 9. 相关文档

| 文档 | 说明 |
|------|------|
| [architecture.md](../overview/architecture.md) | Gateway 在系统架构中的位置 |
| [protocol.md](./protocol.md) | WebSocket 事件协议与 HTTP API |
| [bootstrap.md](../overview/bootstrap.md) | Gateway 启动顺序 |
| [configuration.md](../subsystems/configuration.md) | Gateway 配置项 (port, clients) |
| [gateway-client-design.md](./gateway-client-design.md) | manifest、发行包与开发目录流程；G0 已确认，M1 已实施 |
| [gateway-development-plan.md](./gateway-development-plan.md) | 阶段、影响面与验收；M1 已完成 |
| [packaging plan](./atom_neo_2026-11-14_gateway_client_packaging_plan.md) | M1 执行计划、G0 决策与 G1 子任务状态 |
| [packaging code_and_file](./atom_neo_2026-11-14_gateway_client_packaging_code_and_file.md) | M1 文件清单、示例代码与实施记录 |
| [packaging graph](./atom_neo_2026-11-14_gateway_client_packaging_graph.md) | 模块依赖、启动/安装/重载序列与不变量 |
