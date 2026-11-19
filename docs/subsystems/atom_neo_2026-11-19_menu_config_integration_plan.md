# Atom Neo — Menu 与 Config 整合开发计划

> 项目：`atom_neo`
> 日期：2026-11-19
> 开发目标：`menu_config_integration`
> 状态：**M1–M5 已实施并提交**。代码、测试、CLI、PTY 与文档已收口；三个里程碑 commit 见最终交付记录。
>
> 关联文档：
> - [启动菜单](startup-menu.md)
> - [配置向导](first-run-wizard.md)
> - [TUI 界面](../tui-interface.md)
> - [Gateway](../communication/gateway.md)
> - [配置系统](configuration.md)
> - 文件级改动见 [code_and_file](./atom_neo_2026-11-19_menu_config_integration_code_and_file.md)
> - 关系图见 [graph](./atom_neo_2026-11-19_menu_config_integration_graph.md)

---

## 1. 背景

当前存在两套入口：

```text
atom menu       普通终端菜单（MenuFlow / startMenu）
atom --config   OpenTUI 配置向导（WizardApp）
atom --config --gateway  直接打开 GatewayModal
```

问题：

- menu 偏命令化，无法承载 PDF 设计的层级、面包屑、按钮、滚动列表。
- menu 与 config 是两套 UI/导航，Gateway 配置入口分散。
- `--config` 作为 flag 与 `config` 子命令语义不一致。
- 顶级 Gateway 是快捷入口，但无法在进入真实配置前确认 workspace。

## 2. 目标

用**一个 OpenTUI MenuApp** 同时承载 menu 与 config：

```text
atom menu
atom config
atom config gateway
```

保留现有 CLI 管理命令：

```text
atom gateway ...
```

`atom --config`、`atom --config --gateway` 移除。

---

## 3. 信息架构

```text
ATOM NEO
├─ Session
│  ├─ New Chat
│  ├─ Continue Chat
│  ├─ History
│  └─ Core Server
│     ├─ Start Server
│     ├─ Stop Server
│     └─ Attach Server
├─ Gateway（快捷入口）
│  └─ Workspace 确认
│       └─ GatewayModal
├─ Configure
│  ├─ Workspace path
│  └─ Advanced configuration
│     ├─ Providers & Models
│     ├─ Theme
│     └─ Gateway（真实配置入口）
│          └─ GatewayModal
├─ Backup
│  ├─ Export
│  └─ Import
└─ Quit
```

### 3.1 真实入口与快捷入口

- **真实配置入口**：`Configure → Advanced configuration → Gateway`
- **快捷入口**：顶级 `Gateway`
- 快捷入口进入 `GatewayModal` 之前必须经过 Workspace 确认页
- Configure 内的真实入口使用当前已确认 Workspace，不重复确认

### 3.2 全局 Workspace

MenuApp 维护单一 workspace：

```text
ATOM NEO
workspace: /Volumes/Projects/atom_neo
Gateway: stopped
```

Session、History、Core Server、Gateway、Configure、Backup 全部使用该 workspace。

不是每个菜单项重新输入 sandbox。

---

## 4. CLI 设计

### 4.1 新命令

```text
atom menu
  → MenuApp Home

atom config
  → Configure 页面（Workspace path + Advanced configuration）

atom config gateway
  → Configure → Advanced → Gateway（真实配置入口）
```

### 4.2 移除

```text
atom --config
atom --config --gateway
```

`--config` 不再作为 flag 解析；旧脚本需要改成 `atom config`。

### 4.3 Workspace 解析

`atom config gateway`：

1. 显式 `--sandbox <path>`：直接使用该 workspace。
2. 未显式指定：
   - 当前目录存在 `config.json`：使用当前目录。
   - 当前目录没有配置：先打开 `Configure → Workspace path`。
3. 页面顶部始终显示 workspace。

### 4.4 保留

```text
atom gateway install|upgrade|load|reload|list|start|stop|check|logs|pack|uninstall
atom menu
atom export / import
```

---

## 5. 交互规范

### 5.1 视觉

```text
╭─ ATOM NEO ─────────────────────────────── vX.Y.Z ─╮
│  [Breadcrumb]                                      │
│                                                    │
│   菜单 / 列表 / 表单                               │
│                                                    │
├────────────────────────────────────────────────────┤
│ ↑↓ move   Enter open   Esc back                    │
╰────────────────────────────────────────────────────╯
```

- 当前项：`❯`
- 子菜单：`›`
- 输入确认：`[ OK ]` / `[ Save ]`
- 危险操作：二次确认
- 底部：版本 + 快捷键
- 顶部：workspace / Gateway / Core 状态

### 5.2 键盘

```text
↑ ↓      移动
← →      返回 / 进入或切换动作
Enter    打开 / 执行 / 确认
Esc      返回上一级；Home 退出确认
Del      History 删除
Ctrl+C   退出
```

### 5.3 状态

- Gateway offline：允许 Install / Load / Edit；Register / Start 显示原因。
- Core offline：History 显示不可用，提供 Start Server / Attach Server。
- 空列表显示明确空状态，不显示空白页。
- 错误内联显示，不退出菜单。
- 取消/返回不写 config、.env、history。

### 5.4 Workspace 确认页

顶级 Gateway：

```text
╭─ ATOM NEO ───────────────────── [Gateway] ────────╮
│                                                    │
│   Gateway 配置快捷入口                             │
│                                                    │
│   Workspace                                        │
│   /Volumes/Projects/atom_neo                       │
│                                                    │
│   ❯ Continue to Gateway configuration              │
│     Change workspace ›                             │
│                                                    │
│     ‹ Back                                         │
│                                                    │
├────────────────────────────────────────────────────┤
│ Enter continue   C change   Esc back               │
╰────────────────────────────────────────────────────╯
```

- `Continue` 才进入真实 `GatewayModal`
- `Change workspace` 跳转 `Configure → Workspace path`
- 修改后返回确认页
- workspace 无效/不可写/未初始化时明确报错

---

## 6. 分期计划

### M1：OpenTUI 菜单骨架

- MenuApp、Home、路由、面包屑、版本、快捷键
- 全局 workspace 状态
- Quit 确认
- 非 TTY 报错
- 旧 `atom menu` 的 plain `MenuFlow` 不再作为交互入口

### M2：Session

- New Chat / Continue Chat：退出 MenuApp，启动现有 Chat TUI
- History：列表、打开、删除
- Core Server：Start / Stop / Attach
- 新增 Core API：`GET /api/sessions`
- 新增受控 Core stop 能力

### M3：Configure + Gateway

- Workspace path 编辑与校验
- Advanced configuration 复用现有 config wizard
- Configure → Advanced → Gateway 真实入口
- 顶级 Gateway 快捷入口 + Workspace 确认
- 复用 GatewayModal / GatewayInstanceForm

### M4：Backup

- Export / Import 表单
- 复用现有备份命令与原子写
- Import 覆盖确认

### M5：整合与验收

- `atom menu` / `atom config` / `atom config gateway` 统一
- CLI help、文档、索引
- PTY 全量回归
- 旧 plain menu 测试迁移/删除

---

## 7. 后端/API 改动

### 7.1 Session 列表

新增：

```text
GET /api/sessions
```

建议返回：

```json
[
  {
    "sessionId": "tui-...",
    "lastTuiUsedAt": 1760000000000,
    "initiator": { "type": "tui" },
    "status": "suspended",
    "active": false
  }
]
```

- 复用 `SessionPersistenceService` 的 checkpoint 目录扫描。
- 只读，不创建 session。
- Core 离线时 MenuApp 显示不可用，不自行扫描 sandbox 伪造状态。

### 7.2 Core Stop

新增受控停止入口（推荐）：

```text
POST /api/admin/shutdown
```

- 本机管理 Token 鉴权。
- 先返回响应，再触发优雅关闭。
- 不影响 Gateway/Clients 的独立关闭顺序。
- 失败时明确返回错误，不直接杀进程。

### 7.3 Session 标题

当前没有 title。第一版：

- 优先显示 sessionId 短形式
- 或最后一条用户消息摘要（只读、截断、脱敏）
- 不新增数据库迁移

---

## 8. 验收矩阵

| 范围 | 场景 |
|---|---|
| Home | 方向键、Enter、Esc、Quit 确认 |
| Workspace | 默认当前目录、显式 `--sandbox`、无配置、不可写 |
| Session | New / Continue / Back；启动后 menu 退出 |
| History | 空列表、Core 离线、打开、删除、active 409 |
| Core Server | start / stop / attach、状态刷新、失败重试 |
| Gateway 快捷入口 | workspace 确认、change workspace、取消 |
| Gateway 真实入口 | Configure → Advanced → Gateway、保存/返回 |
| Gateway 操作 | install/load/edit/register/start/reload/check/logs |
| Backup | Export、Import、覆盖确认、取消 |
| CLI | `atom menu`、`atom config`、`atom config gateway`、旧 `--config` 拒绝 |
| 输入 | TTY、非 TTY、窄窗口、长 workspace 路径 |
| 回归 | 现有 Gateway、Backup、Session、PTY 测试 |

---

## 9. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| `--config` 移除破坏旧脚本 | 旧命令失败 | 更新 help/docs/测试；明确 breaking change |
| plain menu → OpenTUI 重写 | 现有 PTY 测试大量变更 | 分阶段替换，先保留旧 controller 测试基线 |
| History 依赖 Core | Core 离线无法列出 | 明确不可用状态 + Start/Attach |
| Core Stop 新增 API | 关闭竞态/资源清理 | 本机 token、先响应后关闭、复用 shutdown |
| WizardApp 嵌入 | 嵌套 ThemeProvider/路由状态 | 使用路由级渲染，不嵌套 Modal |
| Session 无 title | 列表可读性差 | 第一版用 ID/摘要，后续再迁移 |
| 长路径/窄窗口 | 布局溢出 | 截断、省略号、PTY 测试 |
| Gateway 快捷入口 | 用户误操作错误 workspace | 强制 Workspace 确认页 |

---

## 10. 交付判据

第一轮完成：

- `atom menu` 全 OpenTUI
- Session / History / Core Server
- Configure + Advanced + Gateway 真实入口
- 顶级 Gateway 快捷入口 + Workspace 确认
- Backup Export/Import
- `atom config` / `atom config gateway`
- PTY 与文档通过
- 旧 `--config` 不再接受

后续可单独交付：

- Session title
- 更丰富的 History 搜索/预览
- 独立开发者模式
- 真实平台/发布验收

---

## 11. 待确认

- [ ] 接受本计划与信息架构
- [ ] 接受 `atom config` / `atom config gateway` 并移除 `--config`
- [ ] 接受顶级 Gateway 强制 Workspace 确认页
- [ ] 接受 `GET /api/sessions` 与受控 Core stop API
- [ ] 接受第一版 History 使用 sessionId/摘要，不新增 title 迁移

确认后按 M1–M5 实施；三份文档见 code_and_file 与 graph。

## 12. 实施记录（2026-11-19）

| 里程碑 | 交付 |
|---|---|
| M1 | OpenTUI `MenuApp`、Home、workspace/status/面包屑/快捷键/Quit 确认、非 TTY 报错；`atom menu` 改用 MenuApp；新增 `atom config` / `atom config gateway` 并拒绝旧 `--config` |
| M2 | Session New/Continue、History（`GET /api/sessions`、删除 409）、Core Server Start/Stop/Attach；`POST /api/admin/shutdown` 先响应再优雅关闭；History 打开指定 session |
| M3 | Configure / Workspace / Advanced；Providers & Models/Theme 路由级复用 WizardApp；Gateway 真实入口与顶级快捷入口（WorkspaceGate）复用 GatewayModal |
| M4 | Backup Export/Import 表单、merge/replace、覆盖确认；复用 bootstrap backup |
| M5 | 移除旧 plain `MenuFlow`/`startMenu` 与 menu history；CLI help、docs、menu README、PTY 全量回归 |

验证记录（2026-11-19）：

- `bun test src/packages/config-tui/src` → 136 pass
- `bun test src/packages/core/src/http-router.test.ts src/packages/core/src/session src/packages/core/src/server-continuation.test.ts` → 130 pass
- `bun test src/bootstrap/cli.test.ts src/bootstrap/menu-actions.test.ts src/bootstrap/gateway-actions.test.ts src/bootstrap/gateway-command.test.ts` → 61 pass
- `ATOM_RUN_STARTUP_VALIDATION=1 bun test src/bootstrap/startup.integration.test.ts` → 18 pass（含 MenuApp Home/WorkspaceGate/History/Core Stop/Configure/Gateway/Backup/窄窗口/非 TTY）
- `bun run typecheck`、`bun run typecheck:node`、`bun run docs:check`、`git diff --check` 通过

真实 Telegram 平台与官方发布仍按 G6 状态保持 PENDING。
