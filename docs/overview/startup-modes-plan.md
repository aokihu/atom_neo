# 启动模式与 Session 发起者实施计划

> **Purpose**: 明确 Core 常驻、独立 TUI attach、Gateway Client 控制和 Session 发起者的分阶段实施契约。

## 2026-09-17：显式继续上次会话

默认启动及独立 `--mode tui` attach 每次新建 TUI Session。只有 `-c` / `--continue`
才恢复当前 sandbox 中 `initiator.type=tui` 且 lastTuiUsedAt 最近的会话（包括磁盘 checkpoint）。
没有候选时新建；旧会话和 Gateway/internal 会话不删除、不覆盖。纯 Core/Gateway 无 TUI 入口不创建会话。
`POST /api/tui/attach` 接受可选 JSON `{ "continue": true }`；空请求或省略该字段默认新建，
非法 JSON/非布尔值返回 400。并发普通 attach 各自新建；并发 continue 沿用已有同步选择逻辑。
WebSocket 重连继续订阅原 sessionId，不受启动参数影响。以下旧版本描述中的“默认恢复”已由本节替代。


## 开发进度（2026-09-12）

2026-09-14：纳入 v1.15.0。五种启动模式、Session 明确发起者、sandbox 参数和首次向导取消修复已完成；定时任务仅随 Core 运行，恢复不补跑过期任务。TUI 定时信息位于右侧栏，所有 widget 的 EMPTY 使用统一低对比度样式。此前两项验收失败均已修复，最新结果见验证报告；下文保留开发阶段历史。

2026-09-13：验收完成，部分通过。常规测试 1036 项通过；10 项隔离进程测试 8 通过、2 失败（冷启动全局定时任务、取消首次向导）。业务代码未在验收中修改；详见 [验证报告](./startup-validation.md)。下文 2026-09-12 的“待验收”说明为开发阶段记录。

代码已实现，等待用户指令验收。已完成五模式分流、本机 TUI attach、Session initiator/lastTuiUsedAt 持久化、默认 TUI 会话恢复、Gateway 单个/全部 Client 启停与异步关闭。

本轮采用 --action start|stop；保留 full 为 core-gateway 兼容别名。core-server/core-port 必填，完整 attach 当前只支持 localhost/127.0.0.1/::1，使用 --sandbox 指向运行实例的管理凭据文件。Gateway 控制同样通过 sandbox 发现已有服务。

已落地接口：POST /api/tui/attach（本机管理认证，返回 sessionId/serverInfo）、POST /admin/clients（本机管理认证，action + 可选 clientId）。WS session.ready 同步消息、contextTokens 和 activeTaskIds，复用同步握手避免订阅/快照窗口；不提供离线 token 回放。

基础检查：各 workspace 类型检查通过，入口外置依赖打包通过。完整打包受到本机缺少其他平台 OpenTUI 原生包影响，尚未通过。不运行单元测试、真实 Core/TUI/Gateway/Client 或进程级验收；这些等待用户指令。尚未提交或推送。

验收重点保留：首次配置、监听失败清理、attach/detach、磁盘恢复与并发首次 attach、Client 健康就绪与崩溃退避/手动停止、关闭等待、来源冲突及历史 unknown。Core HTTP 监听失败复用 stop 清理；更早初始化失败路径仍需验收关注。


## 原计划与范围

2026-09-12：方案已整理，原阶段仅更新文档并创建分支；用户随后授权开发、延后验收，最新状态见上节。

复用 startCore、startTui、ClientManager、SessionStore、SessionPersistenceService 和现有 HTTP/WebSocket，不重写任务引擎。实现以本文及对应启动、会话、Gateway 文档为准。

## 已确认的模式

| 参数 | 启动或控制内容 | 退出影响 |
|------|------|------|
| 无 mode | Core + TUI | 关闭本进程拥有的 Core 和服务 |
| --mode core | 仅 Core | TUI 缺席不影响调度 |
| --mode core-gateway | Core + Gateway，无 TUI | 等待 Clients、Gateway、Core 清理 |
| --mode tui --core-server <host> --core-port <port> | 独立 TUI attach | 只关闭 TUI 连接 |
| --mode gateway --clients <client_name> | 控制指定 Client | 控制命令结束不停止目标服务 |
| --mode gateway（不带 clients） | 对所有配置的 Clients 执行相同操作 | 返回逐项结果与汇总退出码 |

clients 为配置中的稳定 Client ID，首版为单个值；省略才表示全部。非法或空值不能误解释成全部。gateway 是短时控制模式，不负责新建 Gateway Server。Gateway Server 由 core-gateway 启动。

## 参数待定项与实施建议

Gateway 动作参数建议为必填 --action start|stop，但用户尚未明确确认该拼写；实施前确认，不实现隐式启停切换。以下动作示例均为建议语法。

```bash
atom --mode core --sandbox ./sandbox --port 3100
atom --mode tui --core-server 127.0.0.1 --core-port 3100 --sandbox ./sandbox
atom --mode core-gateway --sandbox ./sandbox
atom --mode gateway --action start --clients telegram-bot --sandbox ./sandbox
atom --mode gateway --action stop --sandbox ./sandbox
```

TUI 的 core-server/core-port 按必填设计，缺失时报参数错误；core-server 为主机名或 IP，core-port 为 1–65535。监听参数 host/port 与连接参数分开。监听默认端口建议明确为 3100，显式 0 才随机分配。非法模式、端口或跨模式参数在启动任何服务之前拒绝。

旧 full 模式不属于新模式集合。建议保留为 core-gateway 的兼容别名并在帮助中标记废弃；是否保留仍为兼容性待定项。更新 dev:gateway 等脚本使用新名称。

## Session 发起者契约

```typescript
type SessionInitiator =
  | { type: "tui" }
  | { type: "gateway"; clientId: string; platform: string }
  | { type: "internal" }
  | { type: "unknown" };
```

initiator 表示创建会话的发起者，不是最后发消息的终端。创建时确定并随 checkpoint 持久化；attach、恢复、内部续写或定时任务沿用会话时都不得覆盖。Gateway 由已认证的 Client 配置提供 clientId/platform，不信任消息体任意声明的 Client 身份。Task.platform 保留为单次任务来源，Task.source 继续区分 INTERNAL/EXTERNAL。

历史数据缺字段恢复为 unknown，不根据 session ID 猜测；下一次正常 checkpoint 写入即可，不批量改写旧目录。内部任务独立创建会话标记 internal，沿用已有会话保持原值。

TUI 默认选择 initiator.type=tui 且最近被 TUI 使用的会话。建议持久化 lastTuiUsedAt（attach 成功及 TUI 用户输入时更新）；后台任务、Gateway 输入和普通缓存读取不得改变排序。同时间戳按稳定 ID 排序。恢复挂起或重启前会话时读取既有 checkpoint 元数据，不只搜索内存缓存，不新增数据库。无候选时由 Core 原子创建 TUI 会话，避免并发 attach 各建一个。

## Attach 与认证

TUI 分支在 Core 服务初始化、数据库打开、sandbox 初始化和安装向导之前分流。独立 TUI 不加载 Agent Provider 凭据，也不成为 Session 磁盘 writer。复用现有消息查询接口并补充运行信息、默认 TUI 会话选择和当前活动任务快照。

接口具体路径在实施时沿用现有 API 命名规范确定。会话选择与无候选创建应由 Core 完成。连接时先订阅再协调历史/任务快照，按消息与任务 ID 去重，避免快照期间漏事件。断线必须解除本地等待、展示断连状态；再次 attach 恢复已保存消息和活动任务，不承诺离线逐 token 回放。

建议 Core 启动后写 .atom/core-runtime.json，包含可连接地址、实例 ID 与受限权限的管理凭据（文件 0600，目录受限）；显式连接地址优先，必须校验文件对应实例，不静默连到其他 Core。Gateway 可用同类运行描述供控制命令发现。关闭仅清理当前实例文件，不向 Client 或日志泄漏管理 token。

现有管理认证仅允许 loopback + adminToken。首版完整 attach 按本机设计；远程 Core 的认证传递、配置权限和 TUI 本地输入历史路径尚未设计，遇非本机地址应明确提示不支持，不静默降级或放开认证。同一 sandbox 单 Core writer 约束继续有效，运行描述文件不等于可靠 writer lock。

## Client 生命周期

ClientManager 增加按 ID start/stop/list 和期望运行状态，复用现有 spawn、健康检查及终止逻辑。启动已运行 Client、停止已停止 Client 应幂等；不存在的名称报错。全部操作返回每项成功或失败，不隐藏部分失败。

管理请求使用本机管理权限，平台 Client secret 不可调用管理接口。操作只影响目标 Client，不取消 Core 已接受的任务。Client 停止期间结果投递失败沿用现有错误处理，不新增消息队列或补投递承诺。

重启定时器必须可取消；手动停止和 Gateway 关闭后禁止再拉起；回调需检查进程实例，防旧进程退出影响新进程。重启前撤销旧 secret；连续失败计数不能每次 spawn 立即清零。Gateway.stop 改为可等待的异步清理，启动失败回滚已经创建的资源。

## 分阶段实施

| 阶段 | 主要文件或职责 | 完成条件 |
|------|------|------|
| 0：文档与分支（本轮） | docs 下计划、启动、Session、Gateway 及 Web 页面 | 文档验证完成；等待开发指令 |
| 1：CLI 与资源归属 | src/bootstrap/cli.ts、src/main.ts、runtime-service.ts、package.json | 五类入口正确分流；非法参数无副作用；无界面不弹首次向导 |
| 2：Session 来源 | shared 类型、session/context.ts、store.ts、persistence-service.ts、任务入口 | 发起者贯通创建/保存/恢复；旧数据 unknown；最近 TUI 选择可靠 |
| 3：独立 TUI | Core API/WS、tui/app.tsx、components/App.tsx、hooks/useChat.ts、client/ws-client.ts | 认证、默认会话、历史/任务状态同步；退出不停止 Core |
| 4：Gateway 控制 | gateway/server.ts、client-manager/index.ts、控制入口 | 单个/全部启停，幂等与并发保护，停止无复活 |
| 5：集成收口 | shutdown、帮助/开发脚本、文档状态 | Core + Gateway 异步退出、失败回滚及验收通过 |

每阶段基于现有测试补充行为测试，避免镜像实现。TUI 的 process.exit 移交入口管理，默认模式等待 Core 清理，attach 模式只释放自身资源。非交互 Core 缺配置时返回可操作错误，引导单独运行 --config。

## 验收矩阵

| 场景 | 预期 |
|------|------|
| Core 无 TUI、无 Gateway | 定时任务进入现有队列并执行 |
| TUI attach、退出、再次 attach | 同一默认 TUI 会话，消息恢复，Core 任务继续 |
| 多个 Gateway 会话与内部任务活跃 | 不改变默认 TUI 会话选择 |
| Session checkpoint 与旧目录恢复 | initiator 不变；缺字段 unknown；不猜 ID |
| Core 重启后 attach | 可选择磁盘上最近使用的 TUI 会话 |
| 两个 TUI 同时首次 attach | Core 原子选择/创建，无重复默认会话 |
| 指定或全部 Client 启停 | 目标正确、重复操作幂等、部分失败可见 |
| Client 崩溃退避中停止 | 定时器取消，旧 secret 失效，不复活 |
| 启动失败或 SIGINT/SIGTERM | 清理拥有的资源，无 Client 遗留 |
| 认证失败、Core/Gateway 未运行 | 明确错误，不自启动其他服务 |

定时恢复继续复用 HookManager.restore：session scope hooks 不跨重启恢复。按 2026-09-13 的规则修正，global 只保留定义，Core 关闭停止触发并取消任务链；delay 保留原截止时间，过期不补跑；interval/cron 跳过离线次数，等待未来触发。TUI 增加 Core 定时任务栏。跨平台定时结果主动推送、系统守护安装和离线事件日志仍不属于本轮。

## 文档与检查

Markdown 与专用 Web 页面同时更新，Web 使用表格、阶段流程及状态说明，不运行时引用 Markdown 正文。执行文档 SSR 检查与 git diff --check；开发阶段再运行 CLI、Session、WS、ClientManager 相关测试及类型检查，最后执行上述进程级验收。

相关文档： [启动](./bootstrap.md)、[会话](../core/session.md)、[Gateway](../communication/gateway.md)。
