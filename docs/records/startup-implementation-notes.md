# Startup Implementation Notes（历史）

> **状态**：历史记录。记录 2026-09-12 前后的启动实现进度、设计记录与改造前基线。
> 当前启动行为以 [bootstrap.md](../overview/bootstrap.md) 为准。

## 开发进度（2026-09-12）

代码已实现，历史验收结果见 [验收记录](../records/startup-validation.md)。已完成五模式分流、本机 TUI attach、Session initiator/lastTuiUsedAt 持久化、默认 TUI 会话恢复、Gateway 单个/全部 Client 启停与异步关闭。

本轮采用 --action start|stop；保留 full 为 core-gateway 兼容别名。core-server/core-port 必填，完整 attach 当前只支持 localhost/127.0.0.1/::1，使用 --sandbox 指向运行实例的管理凭据文件。Gateway 控制同样通过 sandbox 发现已有服务。

已落地接口：POST /api/tui/attach（本机管理认证，返回 sessionId/serverInfo）、POST /admin/clients（本机管理认证，action + 可选 clientId）。WS session.ready 同步消息、contextTokens 和 activeTaskIds，复用同步握手避免订阅/快照窗口；不提供离线 token 回放。

基础检查（开发阶段记录）：各 workspace 类型检查通过，入口外置依赖打包通过。完整打包受到本机缺少其他平台 OpenTUI 原生包影响，当时尚未通过。后续进程级验收结果见 [验收记录](../records/startup-validation.md)。

验收重点保留：首次配置、监听失败清理、attach/detach、磁盘恢复与并发首次 attach、Client 健康就绪与崩溃退避/手动停止、关闭等待、来源冲突及历史 unknown。Core HTTP 监听失败复用 stop 清理；更早初始化失败路径仍需验收关注。


## 设计记录

2026-09-12：本文已按讨论更新设计，原设计记录，最新开发状态见上节。完整分阶段计划见 [启动模式计划](../records/startup-modes-plan.md)。

## 改造前代码基线

| 模式 | 当前实际行为 |
|------|------|
| 默认 | 同进程 Core + TUI |
| core | 仅 Core |
| full | Core + Gateway，无 TUI |
| tui | 参数接受，但没有启动分支；仍先初始化服务 |

当前 port 参数默认 0，但 main 使用 args.port || 3100；不能据帮助宣称随机端口。Core shutdown 已做调度停止、后台任务清理、任务 drain 和 Session checkpoint。TUI 当前直接 process.exit，Gateway.stop 当前未等待 Clients；这两处需要修复。
