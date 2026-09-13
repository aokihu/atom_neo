# Bootstrap & Startup Sequence

> **Purpose**: 当前启动行为与待实施的五模式启动、TUI attach 和资源关闭契约。

## 开发进度（2026-09-12）

代码已实现，等待用户指令验收。已完成五模式分流、本机 TUI attach、Session initiator/lastTuiUsedAt 持久化、默认 TUI 会话恢复、Gateway 单个/全部 Client 启停与异步关闭。

本轮采用 --action start|stop；保留 full 为 core-gateway 兼容别名。core-server/core-port 必填，完整 attach 当前只支持 localhost/127.0.0.1/::1，使用 --sandbox 指向运行实例的管理凭据文件。Gateway 控制同样通过 sandbox 发现已有服务。

已落地接口：POST /api/tui/attach（本机管理认证，返回 sessionId/serverInfo）、POST /admin/clients（本机管理认证，action + 可选 clientId）。WS session.ready 同步消息、contextTokens 和 activeTaskIds，复用同步握手避免订阅/快照窗口；不提供离线 token 回放。

基础检查：各 workspace 类型检查通过，入口外置依赖打包通过。完整打包受到本机缺少其他平台 OpenTUI 原生包影响，尚未通过。不运行单元测试、真实 Core/TUI/Gateway/Client 或进程级验收；这些等待用户指令。尚未提交或推送。

验收重点保留：首次配置、监听失败清理、attach/detach、磁盘恢复与并发首次 attach、Client 健康就绪与崩溃退避/手动停止、关闭等待、来源冲突及历史 unknown。Core HTTP 监听失败复用 stop 清理；更早初始化失败路径仍需验收关注。


## 设计记录

2026-09-12：本文已按讨论更新设计，原设计记录，最新开发状态见上节。完整分阶段计划见 [启动模式计划](./startup-modes-plan.md)。

## 改造前代码基线

| 模式 | 当前实际行为 |
|------|------|
| 默认 | 同进程 Core + TUI |
| core | 仅 Core |
| full | Core + Gateway，无 TUI |
| tui | 参数接受，但没有启动分支；仍先初始化服务 |

当前 port 参数默认 0，但 main 使用 args.port || 3100；不能据帮助宣称随机端口。Core shutdown 已做调度停止、后台任务清理、任务 drain 和 Session checkpoint。TUI 当前直接 process.exit，Gateway.stop 当前未等待 Clients；这两处需要修复。

## 模式契约（已实现，待验收）

| 参数 | 行为 |
|------|------|
| 无 mode | Core + TUI |
| --mode core | 仅 Core，Agent 与调度持续运行 |
| --mode core-gateway | Core + Gateway，无 TUI |
| --mode tui --core-server <host> --core-port <port> | 仅 TUI，attach 已运行 Core |
| --mode gateway --clients <name> | 控制指定 Client；省略 clients 则全部 |

Gateway 为短时控制进程，不是 Gateway Server 启动模式。动作建议 --action start|stop（必填，拼写待确认）。full 兼容别名是否保留待定。core-server/core-port 按必填设计，本机完整 attach；非本机认证不在首版范围。clients 对应配置 ID，空值/非法值不能视为全部。

## 参数与配置

保留 host、port、sandbox、config 和现有 log 参数。host/port 负责监听，core-server/core-port 负责连接。建议默认监听 3100、显式 port=0 随机分配，连接端口必须为 1–65535；跨模式不适用参数提前拒绝。

.env 和 config.json 只由需要它们的模式加载。Core 模式缺配置应报错提示单独 --config，不能弹交互向导；默认交互模式保留首次安装流程。日志 console 应在无 TUI 的 Core/Core+Gateway/控制模式可用，避免污染 TUI；Client 输出沿用独立 stdio 配置。

## 目标启动顺序

```text
解析并校验参数
  ├─ config / wizard → 独立配置界面 → 返回
  ├─ tui → 校验目标与认证 → Core 选择 TUI 会话 → 同步历史/状态 → UI
  ├─ gateway → 发现已有 Gateway → 认证 → 单个/全部操作 → 返回
  └─ 默认 / core / core-gateway
       → env/config → 日志 → 配置检查 → sandbox 初始化
       → RuntimeService → ServiceManager.startAll
       → startCore（Session/工具/任务/HookManager/HTTP/WS）
       → 默认：startTui；core：常驻；core-gateway：startGateway
```

TUI 与 gateway 控制分支不得初始化 Core 数据库、Provider 或后台服务。运行信息由 Core 提供，不能让独立 TUI 重新推导模型与工具状态。地址为监听通配符时，发现文件中转换为可连接的本机地址。

## Attach 和 Session

默认 attach 最近使用的 initiator.type=tui 会话；无候选由 Core 原子创建。initiator 与 lastTuiUsedAt 随现有 checkpoint 保存，磁盘挂起会话也可参与选择。Gateway/内部任务活动不改变默认 TUI 目标，历史未知来源不通过 ID 推断。

建议受限权限的 .atom/core-runtime.json 提供本机实例与管理凭据，明确目标优先并校验实例。沿用 loopback + adminToken；运行描述不是 writer lock。连接成功后同步历史及活动任务，断线只移除订阅，不取消任务。WebSocket 与快照同步必须避免漏事件/重复显示。

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

## 实现入口与验收

| 文件 | 职责 |
|------|------|
| src/bootstrap/cli.ts | 参数与帮助 |
| src/main.ts | 提前分流、资源归属、失败回滚 |
| src/packages/core/src/server.ts | 运行信息、Session 选择与既有任务服务 |
| src/packages/tui/src/app.tsx | 独立界面及返回生命周期 |
| src/packages/gateway/src/server.ts | Client 管理接口与异步 stop |

验收覆盖：五模式分流、无界面定时执行、TUI attach/detach/重启恢复、非法参数无副作用、关闭无遗留。当前健康接口仅报告 status/uptime/queue，新的运行信息接口不能假定这些信息已经存在。

相关文档：[计划](./startup-modes-plan.md)、[Session](../core/session.md)、[Gateway](../communication/gateway.md)、[配置](../subsystems/configuration.md)。

## 首次向导子进程修正（2026-09-12）

取消配置必须结束当前启动：首次向导收到 Ctrl+C、Ctrl+D、EOF 或取消操作时，以失败状态退出，不写入 installed 标记，不启动 Core/TUI。只有保存成功才允许继续首次启动。独立 --config 取消后正常退出配置界面，也不启动 Core。销毁界面本身不代表配置成功。

编译后的 Bun 虚拟文件路径仍可被 existsSync 判为存在，不能据此判断源码模式。二进制应以 process.execPath + --wizard + --sandbox 启动自身；源码模式应运行 Bun.main 主入口，而不是 bootstrap/first-run.ts 模块。向导使用 parseArguments 已解析的 args.sandbox，兼容空格与等号参数写法。

依据：[Bun 可执行文件与虚拟文件系统](https://bun.sh/docs/bundler/executables)、[Bun.main 主入口](https://bun.sh/docs/runtime/utils)。本修正只做定向启动验证，完整验收仍等待用户指令。
