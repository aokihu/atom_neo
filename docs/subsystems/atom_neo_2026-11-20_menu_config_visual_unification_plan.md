# Atom Neo — Menu 与 Config 视觉统一开发计划

> 项目：`atom_neo`
> 日期：2026-11-20
> 开发目标：`menu_config_visual_unification`
> 状态：**M1–M5 已实施**。MenuApp/Configure 已统一为左右分栏 shell；最终验证见第 10 节。
>
> 关联文档：
> - [启动菜单](startup-menu.md)
> - [配置向导](first-run-wizard.md)
> - [TUI 界面](../tui-interface.md)
> - [配置系统](configuration.md)
> - 文件级改动见 [code_and_file](./atom_neo_2026-11-20_menu_config_visual_unification_code_and_file.md)
> - 关系图见 [graph](./atom_neo_2026-11-20_menu_config_visual_unification_graph.md)

---

## 1. 背景

`atom menu` 与 `atom config` 目前已经共用 `MenuApp`，但视觉仍是两套：

- `atom menu`：品牌标题、版本号、breadcrumb、workspace、Gateway/Core 状态、单列列表。
- `atom config`：居中的 `CONFIGURATION` 分栏菜单，左侧导航、右侧详情，设置项另开 Modal。
- Configure 仍有一层 `Advanced configuration`，导致 `atom config` 不是一步进入系统设置。
- 两套界面切换时，标题、状态、选中行、提示和窄窗口行为不一致。

目标是把两者收敛为一套视觉和导航语言，同时保留两个子命令。

---

## 2. 已确认决策

| 决策 | 选择 |
|---|---|
| Configure 结构 | **扁平化设置**：Workspace path + Providers & Models + Model Profiles + Decisions + Theme + Gateway + Save & Exit |
| `atom config` 落点 | **Configure 首页**，与 `atom menu → Configure` 完全一致 |
| 整体布局 | **左右分栏**：左侧导航、右侧详情；64 列以下退化为单列 |
| 主视觉参考 | `atom config` 的分栏与详情面板 |
| 吸收的 menu 视觉 | 品牌标题、版本号、父级上下文 breadcrumb、workspace、Gateway/Core 状态、选中行、错误/提示、长列表滚动、窄窗口截断 |
| CLI | `atom menu`、`atom config`、`atom config gateway` 全部保留 |

---

## 3. 信息架构

```text
Home
├─ Session
│  ├─ New Chat
│  ├─ Continue Chat
│  ├─ History
│  └─ Core Server
├─ Gateway（快捷入口）
│  └─ WorkspaceGate → Gateway 真实配置
├─ Configure ◄── atom config 落点
│  ├─ Workspace path
│  ├─ Providers & Models
│  ├─ Model Profiles
│  ├─ Decisions
│  ├─ Theme
│  ├─ Gateway（真实入口）
│  ├─ Save & Exit
│  └─ Back
├─ Backup
│  ├─ Export
│  └─ Import
└─ Quit
```

`Advanced configuration` 不再作为独立页面；其设置项直接成为 Configure 的菜单项。

---

## 4. 视觉规范

### 4.1 统一窗口

```text
╭─ ATOM NEO · <页面名> ───────────────────────────────────── vX.Y.Z ─╮
│ [breadcrumb，仅标题未体现的父级上下文]                            │
│ workspace: /path/to/workspace                                      │
│ Gateway: ● online/offline      Core: ● online/offline              │
│                                                                    │
│  ❯ 左导航项             │  右侧标题                                  │
│    左导航项             │  右侧详情 / 当前值                          │
│                        │                                            │
│  ↑/↓ move  ↵ open  Esc back                                        │
╰────────────────────────────────────────────────────────────────────╯
```

### 4.2 颜色与层级

- 标题：`text.bright` + bold。
- 版本号：`text.muted`，固定在标题行右侧，不收缩。
- Breadcrumb / workspace：`text.muted`，按显示宽度截断。
- 状态：`status.success` / `status.warning` / `text.muted`。
- 选中行：`accent.brand` 的 `❯` + `text.bright`，可选 `decoration.subtle` 背景。
- 未选中行：`text.secondary`。
- 右侧标题：大写、`text.bright`；正文 `text.secondary` / `text.muted`。
- 错误：`status.error`；成功提示：`status.success`。
- 分隔线：`border.default`。

### 4.3 选中与详情

左侧导航保持 10 行窗口滚动，右侧详情随选中项更新。每个页面提供：

```ts
type MenuPreview = {
  title: string;
  lines: string[];
};
```

没有专门 preview 的页面使用默认详情：`label` + `detail` + 当前操作提示。

### 4.4 响应式

- `>= 80` 列：左右分栏。
- `64–79` 列：隐藏右栏，列表项下方内联 detail。
- `< 64` 列：只保留标题、状态、导航和底部 hint。
- 标题、breadcrumb、workspace、版本号继续使用 shared `stringWidth` 截断。

---

## 5. 交互规范

### 5.1 键盘

```text
↑ / ↓      移动选择
Enter      打开 / 执行
Esc        返回上一级；Home 打开 Quit 确认；表单取消
Del        History 删除选中会话（需确认）
Ctrl+C     Quit 确认
```

### 5.2 状态

- Gateway offline：允许 Install / Load / Edit；Register / Start 显示原因。
- Core offline：History 显示不可用；提供 Start / Attach。
- 空列表显示明确空状态。
- 错误和 notice 内联显示，不退出 TUI。
- 取消/返回不写 config、.env、history。

### 5.3 保存与退出

- Configure 的 `Save & Exit` 写入 `config.json` / `.env`，停留在 Configure 并显示 `Saved`。
- 未保存修改时从 Configure 返回 Home，弹出丢弃确认。
- Quit 关闭 MenuApp；Chat/Core/Attach 仍走现有 `MenuLaunch`。

---

## 6. CLI

```text
atom menu
  → MenuApp(initial = Home)

atom config
  → MenuApp(initial = Configure)

atom config gateway
  → 已有 config：Gateway 真实配置页（back = Configure）
  → 无 config：WorkspaceGate → Gateway 真实配置页
```

`atom menu` 与 `atom config` 使用同一个 `startMenuApp`、同一个 `MenuApp` 和同一套路由，仅初始路由不同。

---

## 7. 分期计划

### M1 — 统一 Shell

- `MenuScreen` 增加右栏 preview 与响应式分栏。
- 统一标题、版本、breadcrumb、workspace、状态、hint。
- Home / Session / History / Core Server / Backup 迁移到新 shell。
- 保持现有键盘、滚动、错误/提示行为。

### M2 — Configure 合并

- 移除 `advanced` 路由，Configure 直接展示设置项。
- `WizardApp` 增加 embedded 模式：不创建独立背景，不重复 ThemeProvider 外壳。
- 新增 `ConfigureMenu`（基于 `MenuScreen`）：Workspace + Providers + Profiles + Decisions + Theme + Gateway + Save & Exit + Back。
- `atom config` 初始路由改为 Configure。
- Workspace 编辑使用覆盖层，保持 wizard 未保存状态。
- Save & Exit 返回 Configure 并显示 Saved。

### M3 — 设置与编辑器视觉统一

- Providers & Models 改为左列表 + 右详情。
- Theme 改为左主题列表 + 右色块预览；选择后停留 Theme 继续切换，Esc 返回 Configure，Save & Exit 才持久化。
- Profiles / Decisions / Gateway / Backup 表单统一 Modal 宽度、标题、hint、版本号。
- Gateway 内部 clients/actions 视图保持现有行为，只统一 chrome。

### M4 — 响应式与测试

- 100 / 64 / 40 列 PTY：标题、版本、workspace、列表、hint。
- Home / Session / Configure / Advanced 移除后的导航回归。
- Providers / Theme / Gateway / Backup 取消与保存。
- CJK / 长路径 / 长 breadcrumb。
- `atom menu` / `atom config` / `atom config gateway` 初始路由。

### M5 — 文档与收口

- 更新 `startup-menu.md`、`first-run-wizard.md`、`configuration.md`、`tui-interface.md`、README。
- 更新 CLI help：`config` 说明为 `menu → Configure` 快捷入口。
- `docs:check`、全量测试、PTY、typecheck、git diff --check。

---

## 8. 验收标准

- `atom menu` 与 `atom config` 视觉完全一致，仅初始页面不同。
- `atom config` 一步进入 Configure，且与 Home → Configure 是同一页面。
- Configure 不再出现 `Advanced configuration`。
- 设置项、Gateway、Backup 的视觉与统一 shell 一致。
- 100 / 64 / 40 列无溢出、无折行、版本号完整。
- 现有 Gateway / Backup / Session / Core 行为不回归。
- 全量测试 0 fail；新增 PTY 用例通过。

---

## 9. 风险

- `WizardApp` 状态在 Workspace 编辑/路由切换时可能丢失；必须用覆盖层而非卸载。
- 移除 `advanced` 路由会影响现有测试、breadcrumb、文档和 `atom config gateway` 返回路径，需要一次性同步。
- Providers/Theme 从 Modal 改为分栏页面会增加键盘与焦点处理，需要补 PTY 覆盖。
- 运行中 Core 的配置重载语义已由 2026-11-19 修复覆盖，本目标不重复修改。

## 10. 实施记录

| 里程碑 | commit | 结果 |
|---|---|---|
| docs | `a6669dc` | 三份设计文档与索引 |
| M1 | `df56741` | MenuScreen 分栏/preview；Home/Session/History/Core/Backup 迁移 |
| M2 | `3073f9b` | Configure 扁平化、embedded WizardApp、Workspace 覆盖层、Save & Saved |
| M3 | `714358a` | Providers/Theme 分栏；Profiles/Decisions/Gateway/Backup chrome 统一 |
| M4 | `af46135` | 100/64/40 PTY、扁平 Configure、Responsive shell |
| M5 | 本文档 commit | CLI help、startup/first-run/configuration/tui-interface/README |

验证：

- `bun test src/packages/config-tui/src src/packages/tui-kit/src` → 221 pass
- `ATOM_RUN_STARTUP_VALIDATION=1 bun test src/bootstrap/startup.integration.test.ts` → 26 pass
- 全量 `bun test` → 2823 pass、27 skip、0 fail
- `bun run typecheck`、`typecheck:node`、`docs:check`、`git diff --check` 通过

## 11. 复审修复

- Workspace 切换语义：确认后丢弃未保存 Configure state，并从新 workspace 重挂载 WizardApp；取消保持原 workspace/state；相同路径直接关闭。
- 列表行严格单行：MenuScreen 按可用宽度预截断 label/detail，SelectableRow 支持 `truncate`；64/40 列无折行。
- `startWizard` 仅支持 first-run；embedded Configure 删除嵌套 ThemeProvider，主题通过 `onThemeChange` 驱动外层即时预览。
- Confirm/ApiKey/Models/Project/GatewayInstanceForm/WizardQuit 统一 `ATOM NEO ·` 标题、版本号与 title truncate。
- 测试补充 A→B workspace 文件断言、Add Provider 覆盖层、表单 chrome、100/64/40 Home/Session/Configure/Backup PTY。
