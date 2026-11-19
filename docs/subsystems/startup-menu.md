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
├─ Workspace path
└─ Advanced configuration
   ├─ Providers & Models
   ├─ Theme
   └─ Gateway → GatewayModal（真实入口）
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
- `atom config`：打开 Configure 页面。
- `atom config gateway`：
  - 显式 `--sandbox` 直接使用该 workspace；
  - 未显式指定且当前目录存在 `config.json`：使用当前目录；
  - 未显式指定且当前目录没有配置：先进入 Configure → Workspace path，保存后进入 Gateway 配置。
- `atom --config`、`atom --config --gateway` 已移除，必须被 CLI 拒绝。
- `atom gateway ...` 子命令保持不变。

## 全局 Workspace 与状态

- MenuApp 维护单一 workspace；Session、History、Core Server、Gateway、Configure、Backup 全部使用它。
- 顶部显示 workspace、Gateway 状态、Core 状态。
- 修改 Workspace 会更新后续页面使用的 sandbox；取消不写配置。
- Gateway 进程状态来自 supervisor/admin API；平台检查来自 Client `/diagnostics`。
- Core 离线时 History 显示不可用，提供 Start Server / Attach Server；不自行扫描 sandbox 伪造历史。

## 交互

- `↑/↓` 移动，`Enter` 打开/执行，`Esc` 返回上一级；Home Esc 打开 Quit 确认。
- `Del` 在 History 删除选中 session；active session 由 Core 返回 409。
- `Ctrl+C`/`Ctrl+D` 退出；非 TTY 由 `startMenuApp` 明确报错，不静默降级。
- 错误内联显示，不退出菜单；取消/返回不写 config、`.env` 或 history。
- 当前项用 `▸` 标记；列表空状态明确显示，不留空白页。

## Gateway 快捷入口与真实入口

- **快捷入口**：Home → Gateway → WorkspaceGate。Continue 才进入 `GatewayModal`；Change workspace 进入 Workspace path，保存后返回确认页；Esc 返回 Home。
- **真实入口**：Configure → Advanced → Gateway，直接使用当前已确认 workspace，不再经过 WorkspaceGate。
- `GatewayModal` / `GatewayInstanceForm` 与 `atom gateway` CLI actions 复用，不复制表单。
- 安装/加载/保存不自动 start；Register/Start 需显式操作。

## Session / History / Core Server

- New Chat / Continue Chat：关闭 MenuApp，复用现有 `runApp` TUI 启动路径。
- History：`GET /api/sessions` 读取 sessionId、时间、状态、active；打开指定 session 复用 TUI attach；删除走 `DELETE /api/sessions/:id`，active 返回 409。
- 第一版 History 使用 sessionId 短形式，不新增 title 数据库迁移。
- Core Server：
  - Start Server：显式启动现有 Core 前台入口；
  - Stop Server：`POST /api/admin/shutdown`，本机 admin token，先响应再优雅关闭；
  - Attach Server：使用 Core runtime 凭据进入 TUI。

## Backup

- Export：输出路径可选，密码可选；复用 `bootstrap/backup.ts`。
- Import：归档路径、`.env` merge/replace、覆盖确认；加密归档才需要密码。
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
