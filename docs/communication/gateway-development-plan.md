# Gateway 更新开发计划

> 日期：2026-11-14，2026-11-15 修订。状态：**G0、M1（G1）、M2（G2）、M2.1、M3a（G3）、M3b（G4）、M4/G5 已完成；G6 代码与文档完成，真实平台/官方发布验收待执行**。
> 修订：启动方式不再兼容旧 `binary`，实例只接受 `package` / `directory`。
> 目标与建议契约统一见 [接入与发行规划](./gateway-client-design.md)；本文负责阶段、依赖、影响面、验收与进度。

## 1. 开发原则

- 先更新并收口设计文档，再按阶段实施；每阶段形成可运行、可验证的结果。
- 复用现有 ClientManager / ProcessSupervisor、共享 HttpServer、spawnProcess、配置 schema 和启动菜单。
- 移除旧 `binary` 与实例级 `platform`；`clientArgs` 保留用于普通 CLI 参数，凭据只走 `credentials` -> `.env` 引用。`--mode core-gateway` / `--mode gateway --action start|stop` 控制入口保留。
- 只在职责重复或扩展阻塞明确时聚合代码；新增复杂目录必须附 README，文档继续归档到 docs 并更新 index。
- 用户配置、凭据、真实平台账号和未提交改动不作为默认测试数据；测试使用临时 sandbox 与 fake Client。

## 2. 当前影响面

| 已有位置 | 计划职责 |
|---|---|
| `src/packages/shared/src/config/client.ts` | 包/开发目录实例配置的共享校验边界（移除 binary） |
| `src/packages/shared/src/config/schema.ts` | 用户配置与 Gateway overlay 禁止项的兼容性 |
| `src/packages/gateway/src/config.ts` | Gateway 加载后的唯一实例身份与端口规则 |
| `src/packages/gateway/src/client-manager/client-command.ts` | 生产/开发命令数组、cwd、参数与凭据注入 |
| `src/packages/gateway/src/client-manager/index.ts` | 动态登记、状态与指定实例操作；避免依赖旧数组索引重分配活动端口 |
| `src/packages/gateway/src/client-manager/process-supervisor.ts` | 重载串行化、Secret/旧回调/重启计时器归属 |
| `src/packages/gateway/src/server.ts` | 本机管理接口、状态与诊断、在途消息协调 |
| `src/packages/shared/src/utils/process.ts` | 已有运行时中立的进程适配；优先直接复用 |
| `src/packages/shared/src/utils/child-process-env.ts` | 保留管理凭据过滤并增加实例凭据隔离 |
| `src/bootstrap/cli.ts` / `src/main.ts` | 新 gateway 子命令提前分流，复用 sandbox 与实例发现 |
| `src/bootstrap/menu-flow.ts` / `src/bootstrap/menu.ts` | 增量菜单入口、执行交接与非敏感参数记忆 |
| `src/packages/config-tui/src/components/GatewayModal.tsx` / `src/packages/config-tui/src/wizard-logic.ts` | 接入列表、manifest 配置表单、保存与取消 |
| `clients/telegram-bot/src/main.ts` / `clients/telegram-bot/package.json` | 首个 manifest、打包产物、诊断与拒收重试行为 |

包读取、安装和打包只在 Gateway 包内部增加必要职责；跨包只导出实际共用的 schema/类型，不在 shared 增加平台专属逻辑。以上位置为当前已有文件；未来新增文件名由对应阶段确定。

## 3. 阶段与交付

### G0：文档与契约收口

- [x] 核对 2026-11-14 代码，记录已存在的 supervisor、共享配置、Node/Bun 适配与菜单。
- [x] 编写独立规划、开发计划，更新 Gateway 与相关文档入口。
- [x] 收口 manifest 六字段、entry 选择、config/env 映射和 target 校验规则（D1；M1 实现）。
- [x] 收口实例配置分支、包登记结构、在线/离线写入所有者、修订与失败回滚顺序（D2–D4；M1 实现实例读写，包登记由 G2 完成）。
- [x] 收口命令参数、非交互配置方式、诊断返回与超时、pack 输出路径/target 参数（D5、D7–D9）。
- [x] 决定同平台多账号的会话隔离方式：现有 `platform:user` 及冲突拒绝保持为兼容基线；任何新命名规则、旧会话恢复和迁移必须另列决策与测试（D6）。

完成标准：所有实现阻塞决策写回规划；现有行为与目标行为清楚分开。多账号冲突未解决前，不宣称完整多账号接入可用。

### G1：manifest 解析与统一启动描述

依赖 G0。

- [x] 实现单一 manifest 解析/校验，安装、目录加载、pack 和表单共用（M1：`client-package/manifest.ts`）。
- [x] 实例配置改为包/目录二选一；`binary` 配置拒绝并提示重新登记，保留稳定实例 ID（M1）。
- [x] 将所选入口解析为 command/cwd/platform；继续由现有命令构造函数追加保留参数（M1）。
- [x] 实现实例凭据引用到子进程 env 的映射；每次启动读取当前值，过滤其他实例与管理凭据（M1）。
- [x] 增加目标平台不匹配、开发运行时缺失、入口不存在与保留参数覆盖的明确错误（M1 先覆盖入口、凭据与保留参数；target 运行校验由 G2 完成）。

完成标准：安装包与目录开发命令都可通过 fake runtime 启动；开发目录无需先构建 production，发行包不能误走 development。未采用 shell 拼接或新增生命周期管理器。

M1 实施记录：`ResolvedClientConfig` 已贯通 `client-command` / `ProcessSupervisor` / `ClientManager`；`main.ts` 启动前解析实例。包安装、`packages.json`、CLI/TUI 与动态重载由后续 G2–G4 完成；G2 已由 `registry.ts` 接管包路径。

### G2：本地安装、打包与离线配置闭环

依赖 G1。

- [x] 为 Telegram 开发目录增加 manifest 样例，保留现有构建命令；构建产物放入约定位置。
- [x] 实现 tar.gz pack：生产入口校验、目标架构标记、允许文件收集、敏感内容排除；不自动安装依赖或执行构建脚本。
- [x] 实现本地归档安装：暂存、路径边界检查、manifest/target 校验、版本登记与失败清理。
- [x] 实现首次实例配置向导，复用已有表单与 `.env` 写盘能力；取消不产生实例，包与实例的提交结果分别报告。
- [x] 离线写入显式显示保存状态，不隐式启动服务；再次安装相同内容幂等，同版本不同内容拒绝覆盖。
- [x] 支持从同一已安装包创建另一实例，程序包与账号参数分离；会话隔离仍按 G0 决策验收。

完成标准：临时 sandbox 中完成「构建 → pack → 本地 install → 配置 → Gateway 启动 → fake 平台消息往返」，不要求手写 binary 路径。

M2 实施记录：`archive.ts` pack/install、`registry.ts`、`instance-config.ts`、`GatewayInstanceForm.tsx` 已完成；端到端测试 `src/bootstrap/gateway-package.e2e.test.ts` 使用临时 sandbox 与 fake Core/client 完成闭环。`atom gateway` CLI 已在 G3 接线完成。

M2.1 风险硬化：supervisor 在 spawn/restart 时读取 serve 后的真实 gateway 端口；registry read-modify-write 使用 shared `file-lock` 与 `.atom/gateway/packages.lock`（有界重试/超时）。两项均已完成并通过定向测试。

### G3：在线目录加载与手动重载

依赖 G1、G2；先做手动重载。

- [x] 增加认证管理操作：配置快照校验、登记指定实例、重载指定实例；不放宽平台 Secret 权限。
- [x] ClientManager 动态创建/移除/替换 supervisor，分配不与活动实例冲突的稳定端口；stopAll 遍历实际受管实例。
- [x] 实现指定实例的在途请求/结果投递计数与暂停接入；重载等待完成，超时保留原进程并报告忙。
- [x] 修复 Telegram 对 Gateway 非 2xx 响应的处理；验证忙/拒收响应不会被当作消息成功消费。重试策略与现有限流一起验收，不承诺 exactly-once。
- [x] 更新命令入口与 cwd 后通过 supervisor 队列 stop/start；旧 Secret、旧 exit 回调和旧 restart timer 不得影响新进程。
- [x] 重新读取 manifest、配置和凭据；保留实例身份。包 ID/platform 改变、目录消失或校验失败必须明确报错。
- [x] 对接在线配置提交与应用结果；区分已保存、已应用、应用失败，防止多入口写盘冲突（M3a 通过 CLI/离线写入与 reload；M3b 的 UI 编辑复用 `upsertInstance`，保存后提示 reload 生效）。

完成标准：Gateway 与 Core 不重启，只重载目标实例；在途消息、健康重启与手动 stop 并发时行为确定。新进程启动失败可见，其他实例继续工作。源码变更本身不保证自动回滚。

M3a 实施记录：动态 ClientManager、drain/reload、GET 状态/诊断、DiagnosticsStore、Telegram 503/429 offset、`atom gateway` CLI 与 gateway-command 已完成。`load` 相对路径按当前 cwd 解析；Client `/diagnostics` 在 Gateway 侧有界（20 checks / 200 字符 / 8 KiB）并脱敏。

M3b 实施记录：GatewayModal 实例列表/操作/诊断、GatewayInstanceForm 编辑与 SecretFieldInput 真遮罩、shared runtime-file、菜单 install/load/manage/pack、CLI `load --id`、resolver enum/default/clientArgs 校验、PTY 验收已完成。UI 进程状态来自 supervisor/admin API，平台检查来自 Client `/diagnostics`；诊断与日志继续有界脱敏。初审修复补充 admin `register`（在线 load 动态登记 idle 实例，不自动 start；重复 409）、UI admin 5s 超时和 client key 前缀。复审补齐 config-only 闭环：UI/CLI 合并 config 与 supervisor 状态，未登记实例显示 configured/unregistered，可编辑 secret 后 register/start。

### G4：平台接入管理、诊断与日志

依赖 G2、G3。

- [x] GatewayModal 升级为实例列表，显示来源、版本/目录、进程状态、平台诊断、最近错误。
- [x] 增加安装、配置编辑、检查、启停入口；开发操作（加载目录/打包）在入口处标注 developer，重载在实例操作中。
- [x] 安装表单由 manifest.config 驱动；secret 编辑使用固定宽度真实遮罩（G2 仅列表行遮罩）；enum/default 与 resolver 契约一致。manifest v1 暂无字段条件显示契约，因此展示全部声明字段。
- [x] 定义有界 Client 诊断能力；未实现诊断的 Client 显示 unknown/unsupported，不能仅凭 health 判定凭据有效。
- [x] 汇总经过认证的连接事件并附时间；错误按安装、配置、进程、平台和投递阶段定位。
- [x] 实例日志接入现有日志能力；沿用 inherit/ignore 与 Gateway 有界脱敏，UI 只展示诊断事件摘要。
- [x] CLI list/check/logs 与 UI 使用同一查询和控制实现；新命令提前分流，不初始化 Core 数据库或 Provider。
- [x] 扩展既有菜单（install/load/manage/pack），保持简洁层级和执行交接；不记录 Token/Secret。
- [x] `atom gateway load --id <id>`：同一目录可登记不同实例，省略时使用 manifest.id。

完成标准：界面能独立完成一次接入；进程就绪、平台检查、消息往返三个结果可区分。PTY 覆盖键盘导航、取消、错误重试、窄窗口与非交互失败。

### G5：官方获取、升级与卸载

依赖本地安装闭环；升级实例依赖 G3。

- [x] 为 `install telegram-bot[@version]` 增加明确的官方名称到版本/target/下载地址映射；来源可追溯，下载内容有校验。
- [x] 支持 URL 下载后复用本地安装器，不实现第二套校验和落盘流程。
- [x] 发布脚本只生成实际当前 host target；安装不支持的平台时提前报错，不把未构建目标列为已支持。
- [x] 新版本并存安装，用户显式切换指定实例；失败保留旧版本与新版本制品，并恢复旧实例配置。
- [x] 卸载先检查实例引用，不能删除仍被引用的版本；解除引用后删除 registry 与包目录，不删除开发源码、凭据或会话。
- [x] `atom gateway upgrade <instance> [--version]` 在线 reload/register，离线只更新配置。

完成标准：官方名称安装、版本选择、失败恢复与引用保护端到端可验证。文件监听、插件市场与通用 SDK 属后续按需工作，不作为本轮完成条件。

M4/G5 实施记录：`source-index.ts`、`download.ts`、`source-install.ts`、`gateway-upgrade.ts`、registry 文件清理、CLI install/upgrade/uninstall 与 `gateway-release.ts` 已完成。测试使用 loopback HTTP fixture，不访问外网；远程索引/归档仅允许 HTTPS 或 loopback HTTP，发布索引默认安全合并；reload 新版本启动失败会恢复旧 supervisor。真实 Telegram 平台消息往返留 G6。

### G6：集成收口与文档交付

依赖 G1–G5；本地闭环可在 G4 后独立交付，官方分发在 G5 后交付。

- [x] 更新 Gateway、Telegram、配置、Sandbox、启动菜单和开发环境文档，将通过验收的能力从规划迁入当前说明。
- [x] 对新增复杂目录补 README；源码路径、CLI 帮助、索引与包示例一致。
- [x] 完成本地验证矩阵，记录测试结果、运行时、已知限制；真实平台/发布验收标记 PENDING。
- [x] 代码与文档交付完成；真实 Telegram 平台验收、各 target 官方制品、生产索引/URL/checksum **待执行**。
- [x] `drain` 503 增加 `Retry-After: 1`；config.lock stale 指引、`gateway list --json` 兼容说明、tar/download/source-index 安全复核完成。

M4/G6 实施记录：文档收口、范围冻结、本地验证矩阵和真实验收清单已完成；删除 gateway 包本地构建输出中的旧忽略测试产物，验证固定 `src` 路径。真实账号消息往返、限流/重载/恢复人工验收和官方发布仍为 PENDING。

## 4. 验证矩阵

| 范围 | 必验场景 |
|---|---|
| manifest | 缺字段/未知版本、空命令、开发与生产入口选择、保留参数、target 不匹配 |
| 包 | 正常归档、损坏/越界/链接逃逸、同版本重复/冲突、敏感内容排除、失败无半成品 |
| 配置 | `binary` 配置拒绝与迁移提示、包/目录互斥、双实例不同凭据、取消/写盘失败回滚、并发修改冲突 |
| 凭据 | 在线重新读取、仅注入目标实例、管理 Token 过滤、CLI/日志/历史/包中不含凭据 |
| 生命周期 | load/reload/stop/health failure/exit 并发、无旧进程/计时器复活、Secret 撤销、端口不冲突 |
| 消息 | 空闲重载、在途 drain、超时保留旧进程、拒收后重试、新进程失败、其他实例不受影响 |
| 状态与诊断 | health 不能充当平台认证；未知/不支持可见；真实往返单独记录；日志有界 |
| CLI/UI | 源码与发行入口、新旧命令、离线/在线、非交互缺参数、PTY 导航/取消/重试 |
| 运行时 | Bun 与 Node Atom 入口；Telegram 开发入口单独检查 Bun；旧 HTTP adapter/管理鉴权回归 |
| 多账号 | 按 G0 明确的会话规则验证同用户跨账号、旧会话恢复、发起者冲突与默认 TUI 选择 |

每阶段先运行相关定向测试，集成时运行既有检查；以下是计划命令，**不表示本轮已经执行功能验收**：

```bash
bun run docs:check
git diff --check
bun test src/packages/gateway/src
bun test src/packages/shared/src/config
bun test src/bootstrap/cli.test.ts
bun run typecheck
bun run typecheck:node
bun run build:node
ATOM_RUN_STARTUP_VALIDATION=1 bun test src/bootstrap/startup.integration.test.ts
```

> Gateway 测试固定使用 `src/packages/gateway/src`，避免执行 gateway 包本地构建输出中的旧忽略测试；构建制品不作为验证来源。

新命令、安装制品和 UI/菜单另增加对应定向验收；Node 制品调用已有 smoke 工具，不另造一套平台检查。假平台通过仅证明协议链路，Telegram 凭据检查与真实消息往返需使用明确指定的测试账号单独记录。

## 5. 回滚与完成判据

旧 `binary` 配置不再兼容，也不自动迁移；启动时明确报错并提示重新登记为包或目录实例。包安装失败不覆盖旧版本，实例切换失败需报告保存与运行各自状态。开发重载失败可修正源码后重试或停止开发实例；不得恢复已撤销的 Secret。所有退出和失败路径清理其拥有的暂存目录、进程与计时器。

第一轮可交付条件：Telegram 本地标准包安装、开发目录加载/手动重载、实例配置与连接诊断、基本 CLI/平台接入界面均通过对应验收；旧 `binary` 接入不再保留。完整交付再要求官方获取、升级/卸载与多账号边界按本计划验收。文档和功能状态分别更新，未做真实平台验证时明确标注。

## 6. 关联文档

- [接入与发行规划](./gateway-client-design.md)：目标、manifest、包与实例边界、运行流程。
- [Gateway 当前设计](./gateway.md)、[Telegram 当前实现](../clients/telegram-bot.md)。
- [配置系统](../subsystems/configuration.md)、[启动菜单](../subsystems/startup-menu.md)、[编码规范](../standards/coding.md)、[测试规范](../standards/testing.md)。
