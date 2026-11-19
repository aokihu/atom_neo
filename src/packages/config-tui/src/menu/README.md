# MenuApp

OpenTUI 的 menu/config 统一入口，由 `atom menu`、`atom config`、`atom config gateway` 启动。

## 路由

| 路由 | 说明 |
|---|---|
| Home | Session / Gateway / Configure / Backup / Quit |
| Session | New/Continue Chat、History、Core Server |
| History | 读取 Core `GET /api/sessions`；打开/删除 |
| Core Server | Start / Stop（受控 shutdown）/ Attach |
| Gateway shortcut | 先经过 WorkspaceGate，再进入现有 `GatewayModal` |
| Configure | Workspace path / Advanced configuration |
| Advanced | Providers & Models / Theme / Gateway（复用 `WizardApp` / `GatewayModal`） |
| Backup | Export / Import 表单，复用 `bootstrap/backup` |
| WorkspaceGate | Enter 继续 · C / Change workspace 进入路径编辑 · Esc 返回 |

## 边界

- 单一 workspace，顶部显示 workspace / Gateway / Core 状态。
- 不复制 GatewayModal、GatewayInstanceForm、config wizard 或备份实现。
- 所有启停、安装、保存均为显式操作。
- Token/Secret 不进入菜单历史、日志或 UI。
- 非 TTY 由 `startMenuApp` 明确报错。
- `MenuActions` 由 bootstrap 注入，config-tui 不导入 bootstrap。

## 测试

- `menu-app.test.tsx`：Home、workspace gate/C、Configure/Advanced/Gateway、theme/port 刷新、Wizard 返回、失败反馈、Quit。
- `menu-views.test.tsx`：长列表滚动、长路径省略、History 删除确认键盘隔离/attached 保护、Core Server start/stop/attach。
- `backup-view.test.tsx`：遮罩密码、短密码拒绝、明文警告、加密导入与取消。
