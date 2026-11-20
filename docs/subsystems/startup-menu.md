# Startup Menu / MenuApp

> 状态：M1–M5 MenuApp 统一入口。旧 plain `MenuFlow` / `startMenu` 交互已移除；历史变更见 [startup-menu-changelog.md](../records/startup-menu-changelog.md)。

`atom menu` 打开统一的 OpenTUI MenuApp，同时承载启动菜单与配置入口：

```text
ATOM NEO
workspace: /path/to/sandbox
Gateway: online|offline    Core: online|offline

Session
├─ New Chat
├─ Continue Chat
├─ History
└─ Core Server
   ├─ Start Server
   ├─ Stop Server
   └─ Attach Server
Gateway（快捷入口）
└─ Workspace 确认 → GatewayModal
Configure
├─ Workspace path（覆盖层编辑）
├─ Providers & Models
├─ Model Profiles
├─ Decisions
├─ Theme
├─ Gateway → GatewayModal（真实入口）
├─ Save & Exit
└─ Back
Backup
├─ Export
└─ Import
Quit
```

## CLI

```bash
atom menu
atom config
atom config gateway [--sandbox <path>]
```

- `atom menu`：从 Home 开始。
- `atom config`：一步打开统一的 Configure 设置页，与 `atom menu → Configure` 完全一致。
- `atom config gateway`：
  - 目标 sandbox 存在 `config.json`：直接进入 Gateway 配置；
  - 目标 sandbox 没有配置：无论是否显式 `--sandbox`，先进入 Configure → Workspace path，保存后进入 Gateway；
  - 路由判定只做只读检查，不会因为打开菜单而创建 `config.json`。
- `atom --config`、`atom --config --gateway` 已移除，必须被 CLI 拒绝。
- 非 TTY 的 `atom menu` / `atom config` / `atom config gateway` 明确报错，且不写 `config.json`。
- `atom gateway ...` 子命令保持不变。

## 全局 Workspace 与状态

- MenuApp 维护单一 workspace；Session、History、Core Server、Gateway、Configure、Backup 全部使用它。
- 顶栏第一行左侧 `ATOM NEO · <页面名>`、右侧 muted 版本号（`Modal.headerRight`，同一行右对齐）；第二行 breadcrumb；第三行 workspace；随后是 Gateway/Core 状态。Home 的结构化 breadcrumb 为 `undefined`，空值不渲染 breadcrumb 行，workspace 直接跟随标题行。
- 三行使用同一左缩进；宽度按 `@atom-neo/shared` 的 `stringWidth` 计算。标题先按可用宽度截断并保留完整版本号，breadcrumb 单行截断，workspace 在扣除 `workspace: ` 前缀后中部省略。64/40 列下标题+版本、breadcrumb、workspace、Gateway/Core 状态均保持单行。
- 启动失败重试时使用最后一次 launch 选择的 workspace 重新打开 MenuApp，不回退到原始 `args.sandbox`。
- MenuScreen 统一使用左右分栏：`>=80` 列左侧导航、右侧 preview；`64–79` 列单列并内联 detail；`<64` 列隐藏 detail。长列表保持 10 行窗口滚动。
- Configure 使用同一个 MenuScreen/预览逻辑，Workspace 编辑为覆盖层，不卸载 embedded WizardApp，未保存的 wizard state 保持不变。
- `createMenuActions` 严格只读配置：`config.json` 缺失时 theme=edex、Gateway port=3000，不创建目录或文件。
- 修改 Workspace 会规范化绝对路径并更新后续页面使用的 sandbox；取消不写配置。
- theme / Gateway port 是 MenuApp state；Wizard 保存/取消、端口编辑或 workspace 切换后通过 `refreshSettings()` 重新读取并渲染。
- Gateway 进程状态来自 supervisor/admin API；平台检查来自 Client `/diagnostics`。
- Core 离线时 History 显示不可用，提供 Start Server / Attach Server；不自行扫描 sandbox 伪造历史。

## 交互

- `↑/↓` 移动，`Enter` 打开/执行，`Esc` 返回上一级；Home Esc 打开 Quit 确认。
- `C` 在 Gateway WorkspaceGate 直接进入 Change workspace。
- `Del` 在 History 删除选中 session：先弹 `MenuConfirm`，取消不得调用删除 API；active 或 attached session 在 UI 与 Core 双重拒绝。
- `Ctrl+C`/`Ctrl+D` 退出；非 TTY 由 `startMenuApp` 明确报错，不静默降级。
- 错误内联显示，不退出菜单；取消/返回不写 config、`.env` 或 history。
- 当前项用 `▸` 标记；列表超过 10 项时按选中项滚动窗口，选中项始终可见；列表空状态明确显示。

## Gateway 快捷入口与真实入口

- **快捷入口**：Home → Gateway → WorkspaceGate。Continue 才进入 `GatewayModal`；C 或 Change workspace 进入 Workspace path，保存后返回确认页；Esc 返回 Home。
- **真实入口**：Configure → Gateway，直接使用当前已确认 workspace，不再经过 WorkspaceGate。
- Configure 由 embedded WizardApp 承载；Providers/Profiles/Decisions/Theme/Gateway 保存或取消后回到同一 Configure。
- Configure → Save & Exit 提交 `config.json` / `.env` 后停留 Configure 并显示 `Saved`；Back/Esc 在未保存时走 Quit 确认。
- `GatewayModal` / `GatewayInstanceForm` 与 `atom gateway` CLI actions 复用，不复制表单。
- Gateway 端口保存只校验 1–65535 并在原 config 上合并；损坏的 `config.json` 返回内联错误，不崩溃渲染器。
- 安装/加载/保存不自动 start；Register/Start 需显式操作。

## Session / History / Core Server

- New Chat / Continue Chat：关闭 MenuApp，复用现有 `runApp` TUI 启动路径。
- 新 TUI attach 前 Core 会以 strict 模式重新读取 `config.json` 与 runtime overlay，因此 `atom config` 保存的 theme/provider/model 对新进入的 TUI 生效；缺失/损坏只 warn 并沿用旧配置，不会创建或重写文件。已运行 TUI 不热更新，需重新进入或使用 `/settings`。`.env` Key 修改仍需重启 Core。
- 启动失败（端口占用、缺 provider、Attach 404 等）打印错误并重新打开 MenuApp，可继续重试；不直接退出进程。
- History：`GET /api/sessions` 读取 sessionId、时间、状态、`active`、`attached`；打开指定 session 复用 TUI attach；删除走 `DELETE /api/sessions/:id`。
- `GET /api/sessions`、`GET/DELETE /api/sessions/:id` 需要 admin token（菜单使用 Core runtime token）。
- `active` 表示持有任务 lease；`attached` 由 WS open/TUI 连接持有引用，WS close/TUI 退出释放。HTTP attach 只准备 session，不永久标记；attach 持久化失败不留下 attached。
- 只有 attached 引用计数归零后，sweep/evict/delete 才恢复；`active || attached` 都返回 409，避免跨菜单删除正在使用或可恢复的 session。
- 第一版 History 使用 sessionId 短形式，不新增 title 数据库迁移。
- Core Server：
  - Start Server：使用当前 boot 端口（默认 3100）显式启动 Core 前台入口；Core 已在线时拒绝并提示 “Core already running; use Attach Server.”，不会再次绑定端口；
  - Stop Server：`POST /api/admin/shutdown`，本机 admin token，先响应再优雅关闭；菜单轮询 offline 状态后刷新；
  - Attach Server：使用 Core runtime 凭据进入 TUI。

## Backup

- Export：输出路径可选；非空密码使用遮罩、至少 8 位并二次确认；空密码必须确认“生成明文归档，包含 API Key”。
- Import：归档路径、`.env` merge/replace、覆盖确认；先检查归档信封，只有加密归档才询问密码。
- 取消不写归档/config/.env；导入仍由现有原子写入与备份文件机制保护。

## 旧入口说明

- plain menu bootstrap 文件（`menu`、`menu-flow`、`menu-history`）及交互测试已移除。
- 不再维护 `~/.config/atom/menu_history.json` 作为菜单参数来源；新 MenuApp 的 workspace 由当前 sandbox、显式 `--sandbox` 或 Configure 页面决定。
- `atom export` / `atom import` 直接命令保留；MenuApp Backup 复用同一底层实现。

## 验证

- `bun test src/packages/config-tui/src/menu`
- `bun test src/bootstrap/cli.test.ts`
- `bun test src/packages/core/src/http-router.test.ts src/packages/core/src/session`
- PTY：`ATOM_RUN_STARTUP_VALIDATION=1 bun test src/bootstrap/startup.integration.test.ts`
- `bun run typecheck`、`typecheck:node`、`docs:check`、`git diff --check`

## 相关文档

- [first-run-wizard.md](./first-run-wizard.md)
- [configuration.md](./configuration.md)
- [bootstrap.md](../overview/bootstrap.md)
- [Gateway](../communication/gateway.md)
