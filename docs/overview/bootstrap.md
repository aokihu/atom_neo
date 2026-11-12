# Bootstrap & Startup Sequence

## menu 启动向导

`atom menu` 在 Core/配置服务初始化前进入普通终端向导，最后一步自动执行原有启动入口。支持回退、参数回填及失败重试，成功后不返回菜单。历史固定为 `~/.config/atom/menu_history.json`，仅在成功就绪后保存；详见 [startup-menu.md](../subsystems/startup-menu.md)。

> **Purpose**: 当前启动行为与五模式启动、TUI attach 和资源关闭契约。

## Session 继续策略

默认启动及独立 `--mode tui` attach 每次新建 TUI Session。只有 `-c` / `--continue`
才恢复当前 sandbox 中 `initiator.type=tui` 且 lastTuiUsedAt 最近的会话（包括磁盘 checkpoint）。
没有候选时新建；旧会话和 Gateway/internal 会话不删除、不覆盖。纯 Core/Gateway 无 TUI 入口不创建会话。
`POST /api/tui/attach` 接受可选 JSON `{ "continue": true }`；空请求或省略该字段默认新建，
非法 JSON/非布尔值返回 400。并发普通 attach 各自新建；并发 continue 沿用已有同步选择逻辑。
WebSocket 重连继续订阅原 sessionId，不受启动参数影响。


## 历史实现记录

早期开发进度、设计记录与改造前基线见 [startup-implementation-notes.md](../records/startup-implementation-notes.md)。

## 模式契约

| 参数 | 行为 |
|------|------|
| 无 mode | Core + TUI |
| --mode core | 仅 Core，Agent 与调度持续运行 |
| --mode core-gateway | Core + Gateway，无 TUI |
| --mode tui --core-server <host> --core-port <port> | 仅 TUI，attach 已运行 Core |
| --mode gateway --clients <name> | 控制指定 Client；省略 clients 则全部 |

Gateway 为短时控制进程，不是 Gateway Server 启动模式。动作使用 `--action start|stop`；`full` 保留为 `core-gateway` 兼容别名。`core-server`/`core-port` 为 attach 必填；`clients` 对应配置 ID，空值/非法值不能视为全部。

## HTTP 运行时选择

Core/Gateway 的业务层只依赖 `HttpServer` 契约，传输由 `ATOM_HTTP_RUNTIME` 选择：

| 条件 | 结果 |
|------|------|
| 未设置，存在 Bun 全局 | Bun adapter（默认，行为不变） |
| 未设置，无 Bun 全局（Node） | Node adapter（`node:http` + `ws`） |
| `ATOM_HTTP_RUNTIME=bun` | 强制 Bun；Node 下缺少 Bun 全局时启动失败并提示改用 `node` |
| `ATOM_HTTP_RUNTIME=node` | 强制 Node adapter（spike 已验证 Bun 下也可运行） |
| 其他值 | 启动失败：`Invalid ATOM_HTTP_RUNTIME "...": expected "bun" \| "node".` |

入口 `src/main.ts` 在 Core/Core+Gateway/默认 TUI 启动路径中解析一次运行时并创建一个无状态 `HttpServer`，同一实例注入 `startCore` 与 `startGateway`。`--mode tui`、`--mode gateway` 控制、`--config`、`--wizard`、备份/导出/导入分支不创建适配器，也不加载 `ws`。适配器创建失败会进入既有 `shutdown()`，回滚已启动服务。

Node 当前只是可选运行时；Node 构建入口、发布包与 CI 矩阵属于 S10，S9 不承诺 Node 发布支持。

### 两阶段关闭

`HttpServerHandle.stop(false)` 停止接收新连接并关闭空闲 keep-alive，保留正在处理的 HTTP 与 WebSocket；`stop(true)` 关闭 WebSocket 与活跃连接，并等待监听 socket 关闭。重复调用幂等，`stop(true)` 可升级已发起的 `stop(false)`。Core 与 Gateway 的 stop 顺序不变。

Node 源码 smoke（Node >= 26，`ws` external）：

```bash
mkdir -p /tmp/atom-node-core-smoke/node_modules
ln -sfn "$PWD/src/packages/shared/node_modules/ws" /tmp/atom-node-core-smoke/node_modules/ws
bun build scripts/node-smoke/core-runtime.ts --target node --external ws \
  --outfile /tmp/atom-node-core-smoke/core-runtime.mjs
node /tmp/atom-node-core-smoke/core-runtime.mjs
```

覆盖 runtime 检测（无 Bun 全局时默认 `node`）、`/api/health`、TUI attach（`serverInfo.port` 为真实端口）、WS `session.ready` / `ping` → `pong`、`core.stop()` 与临时 sandbox 清理。

Fake conversation（本地 fake SSE 模型 → conversation `completed`）与 Bun → Node cross-runtime smoke 命令见 [development-setup.md](./development-setup.md#71-node-runtime-smoke-optional)。

## 参数与配置

保留 host、port、sandbox、config 和现有 log 参数。host/port 负责监听，core-server/core-port 负责连接。默认监听 3100；显式 `port=0` 由系统分配，连接端口必须为 1–65535；跨模式不适用参数在启动前拒绝。

.env 和 config.json 只由需要它们的模式加载。Core 模式缺配置应报错提示单独 --config，不能弹交互向导；默认交互模式保留首次安装流程。日志 console 应在无 TUI 的 Core/Core+Gateway/控制模式可用，避免污染 TUI；Client 输出沿用独立 stdio 配置。

## 启动顺序

```text
解析并校验参数
  ├─ export / import → 读写 sandbox 配置归档 → 返回
  ├─ config / wizard → 独立配置界面 → 返回
  ├─ tui → 校验目标与认证 → Core 选择 TUI 会话 → 同步历史/状态 → UI
  ├─ gateway → 发现已有 Gateway → 认证 → 单个/全部操作 → 返回
  └─ 默认 / core / core-gateway
       → env/config → 日志 → 配置检查 → sandbox 初始化
       → RuntimeService → 解析 ATOM_HTTP_RUNTIME → 创建 HttpServer
       → 构造 Memory/Skill/Network/Compiler，注册到 ServiceManager
       → ServiceManager.startAll
       → startCore({ services })：每实例创建 PromptRegistry / ElementRegistry / PipelineInstanceStore
       → 默认：startTui；core：常驻；core-gateway：startGateway
```

TUI 与 gateway 控制分支不得初始化 Core 数据库、Provider 或后台服务。运行信息由 Core 提供，不能让独立 TUI 重新推导模型与工具状态。地址为监听通配符时，发现文件中转换为可连接的本机地址。

同一进程可同时运行多个 `startCore` 实例。每个实例独立创建 `PromptRegistry`/`PromptResolver`、`ElementRegistry`、`PipelineInstanceStore`、`SessionStore` 与定时器，并只使用显式注入的 `CoreServices`；不存在模块级注册表、prompt 单例或 pipeline map。`server-dual-instance.test.ts` 使用不同 sandbox、fake runtime、admin token 与端口验证 health/attach/停止互不影响。

## Attach 和 Session

默认每次新建 TUI Session；只有 `-c` / `--continue` 恢复 `initiator.type=tui` 且 `lastTuiUsedAt` 最近的会话，无候选时由 Core 原子创建。initiator 与 lastTuiUsedAt 随 checkpoint 保存，磁盘挂起会话也可参与选择。Gateway/内部任务活动不改变默认 TUI 目标，历史未知来源不通过 ID 推断。

受限权限的 `.atom/core-runtime.json` 提供本机实例与管理凭据，明确目标优先并校验实例。沿用 loopback + adminToken；运行描述不是 writer lock。连接成功后同步历史及活动任务，断线只移除订阅，不取消任务。WebSocket 与快照同步必须避免漏事件/重复显示。

## 生命周期与失败回滚

| 资源拥有者 | 关闭职责 |
|------|------|
| 默认入口 | 销毁 TUI，await Core.stop，再 await services.stopAll |
| core 入口 | 停调度/后台任务，drain，checkpoint，停止服务 |
| core-gateway 入口 | 停接入并 await Clients/Gateway 清理，然后 Core/服务 |
| 独立 TUI | 释放自身 UI/连接，不关闭远端 Core |
| gateway 控制命令 | 输出逐项结果后退出，不关闭 Gateway |

统一 SIGINT/SIGTERM 幂等关闭，部分初始化失败也回滚已创建资源。TUI 不直接结束宿主进程。Core 当前 drain 会重复等待，不能声称总关闭时间有固定上限。

## 定时任务与范围

Core 独立拥有 ScheduleService/HookManager。global 仅表示定义跨重启保留，不能脱离 Core 执行。关闭开始时停止所有触发器，并取消已入队或正在执行的 Hook 任务链，再等待清理完成；已经发生的外部操作不能撤销。

恢复入口只使用 HookManager.restore，session scope 不跨重启恢复。持久化绝对 nextFireAt：一次性 delay 过期后标为 expired，不补跑；未来 delay 保留原截止时间。interval 跳过离线期间的次数并保留周期，cron 从下一个未来时间开始，均不补跑。已完成的一次性任务不能在重启后再次触发。旧数据按 updatedAt/createdAt 与 delayMs/intervalMs 推导时间。

定时执行使用任务保存的 sessionId；缺少归属的 global 任务分配稳定的内部 session，不依赖 TUI 或最近活动会话。TUI 通过受管理凭据保护的 GET /api/schedules 读取当前 Core 的时间任务摘要，不返回 prompt。系统服务安装和定时结果的平台主动推送不在此次范围。

## 实现入口

| 文件 | 职责 |
|------|------|
| src/bootstrap/cli.ts | 参数与帮助 |
| src/main.ts | 提前分流、资源归属、失败回滚 |
| src/packages/core/src/server.ts | 运行信息、Session 选择与既有任务服务 |
| src/packages/tui/src/app.tsx | 独立界面及返回生命周期 |
| src/packages/gateway/src/server.ts | Client 管理接口与异步 stop |

验收覆盖：五模式分流、无界面定时执行、TUI attach/detach/重启恢复、非法参数无副作用、关闭无遗留。当前健康接口仅报告 status/uptime/queue，新的运行信息接口不能假定这些信息已经存在。

相关文档：[计划](../records/startup-modes-plan.md)、[Session](../core/session.md)、[Gateway](../communication/gateway.md)、[配置](../subsystems/configuration.md)。

## 首次向导子进程

取消配置必须结束当前启动：首次向导收到 Ctrl+C、Ctrl+D、EOF 或取消操作时，以失败状态退出，不写入 installed 标记，不启动 Core/TUI。只有保存成功才允许继续首次启动。独立 --config 取消后正常退出配置界面，也不启动 Core。销毁界面本身不代表配置成功。

编译后的 Bun 入口位于虚拟 `/$bunfs/` 路径，`process.argv[1]` 也指向该虚拟路径，不能作为可执行入口。`bootstrap/cli.ts` 据此区分：编译二进制以 `process.execPath + --wizard + --sandbox` 启动自身；Bun 源码用 `bun run <entrypoint>`；Node 直接运行入口脚本，不加 `run`。运行时检测不依赖 `Bun.main`。向导使用 parseArguments 已解析的 args.sandbox，兼容空格与等号参数写法。

依据：[Bun 可执行文件与虚拟文件系统](https://bun.sh/docs/bundler/executables)。历史验收记录见 [启动模式计划](../records/startup-modes-plan.md) 与 [验收记录](../records/startup-validation.md)。
