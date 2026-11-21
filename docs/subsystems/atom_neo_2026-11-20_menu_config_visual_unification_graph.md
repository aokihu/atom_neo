# Atom Neo — Menu 与 Config 视觉统一关系图

> 项目：`atom_neo`
> 日期：2026-11-20
> 开发目标：`menu_config_visual_unification`
> 状态：**M1–M5 已实施**。
>
> 计划见 [plan](./atom_neo_2026-11-20_menu_config_visual_unification_plan.md)；
> 文件与代码见 [code_and_file](./atom_neo_2026-11-20_menu_config_visual_unification_code_and_file.md)。

---

## 1. 模块依赖

```text
┌─────────────────────────────────────────────────────────────────────┐
│                             src/main.ts                             │
│  atom menu / atom config / atom config gateway                      │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │ startMenuApp
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│              @atom-neo/config-tui · MenuApp                          │
│  Home / Session / Gateway / Configure / Backup / Workspace          │
└───────────────┬───────────────────────────────┬─────────────────────┘
                │                               │
                ▼                               ▼
┌──────────────────────────────┐   ┌──────────────────────────────────┐
│ MenuScreen / MenuFrame       │   │ WizardApp (embedded, config)     │
│ - 标题 / 版本 / breadcrumb   │   │ - wizard state / dispatch        │
│ - workspace / status         │   │ - ConfigureView                  │
│ - 左右分栏 / preview         │   │ - Providers/Theme/Profiles/...   │
│ - 单列响应式 / 长列表滚动    │   └───────────────┬──────────────────┘
└───────────────┬──────────────┘                   │
                │                                  ├── ConfigureView ──► MenuScreen
                │                                  ├── ProvidersView ──► MenuScreen
                │                                  ├── ThemeView ──────► MenuScreen
                │                                  ├── ProfilesModal
                │                                  ├── DecisionsModal
                │                                  └── GatewayModal
                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    @atom-neo/tui-kit · Modal / Theme                │
│  headerRight、titleTruncate、SelectableRow、FieldInput、ThemeProvider│
└─────────────────────────────────────────────────────────────────────┘
```

### 关系约束

- `MenuApp` 是唯一应用壳层，不新增第二个 `App`。
- `ConfigureView` 复用 `MenuScreen`，不复制列表、键盘、滚动、截断逻辑。
- `WizardApp` 只保留 wizard 状态与视图调度；配置模式下不创建独立背景。
- `MenuModal.tsx` 删除后，`buildMenuItems` / `describeSelection` 迁移到 `configure-view.tsx`。
- `GatewayModal` / `Backup` 继续复用现有 actions，不复制后端逻辑。
- Breadcrumb 只显示标题未体现的父级上下文：Home/Session/History/Core/Configure/Backup/Export/Import 返回 `undefined`；仅 Gateway 真实配置、Workspace、Providers、Theme 显示。GatewayModal/MenuPrompt 将 context breadcrumb 显式传给 Modal row，first-run 不读取。

---

## 2. 路由状态图

```text
                         ┌──────────┐
              ┌─────────►│   Home   │◄──────────────┐
              │          └────┬─────┘               │
              │               │                     │
              │      ┌────────┼─────────┬───────────┼──────────┐
              │      ▼        ▼         ▼           ▼          ▼
              │  Session   Gateway   Configure   Backup      Quit
              │      │     (shortcut)     │           │
              │      │        │           │           ├── Export
              │      │        ▼           │           ├── Import
              │      │  WorkspaceGate     │           └── Back
              │      │        │           │
              │      │        ▼           ├── Workspace（覆盖层）
              │      │  GatewayModal      ├── Providers & Models
              │      │        │           ├── Model Profiles
              │      │        └───────────┤   Decisions
              │      │                    ├── Theme
              │      │                    ├── Gateway（真实入口）
              │      │                    ├── Save & Exit
              │      │                    └── Back / Quit 确认
              │      │
              │      ├── New Chat ──► close MenuApp ──► runApp(chat)
              │      ├── Continue Chat ──► close MenuApp ──► runApp(chat)
              │      ├── History ──► list / open / delete
              │      └── Core Server ──► Start / Stop / Attach
              │
              └──────── Esc / Back ─────────────────────────────────────┘
```

### 删除的路由

```text
advanced
wizard
```

Configure 的设置项直接由 `WizardApp` 内部的 wizard view 承载，不再经过 MenuApp 顶层 `wizard` 路由。

---

## 3. CLI 启动序列

```text
atom menu
  │
  ├─ parseArguments()
  ├─ runMenuLoop()
  ├─ startMenuApp(sandbox, { initialRoute: "home" })
  └─ MenuApp(initial = Home)

atom config
  │
  ├─ parseArguments()
  ├─ runMenuLoop()
  ├─ startMenuApp(sandbox, { initialRoute: "configure" })
  └─ MenuApp(initial = Configure)
        └─ WizardApp(embedded, initialView = "menu")

atom config gateway
  │
  ├─ createMenuActions().hasConfig(sandbox)
  ├─ 有 config ──► MenuApp(initial = "gateway-real", back = "configure")
  └─ 无 config ──► MenuApp(initial = "workspace", after = "gateway-real")
```

---

## 4. Configure 编辑与保存序列

```text
用户                    MenuApp                 WizardApp              TUI Kit / FS
 │                         │                        │                       │
 │  atom config            │                        │                       │
 ├────────────────────────►│                        │                       │
 │                         │ route = configure      │                       │
 │                         ├───────────────────────►│                       │
 │                         │                        │ buildInitialState     │
 │                         │                        │◄──────────────────────┤
 │                         │                        │ ConfigureView         │
 │                         │                        ├──► MenuScreen          │
 │  ↑/↓ / Enter            │                        │                       │
 ├────────────────────────►│                        │                       │
 │                         │                        │ dispatch(menu-select) │
 │                         │                        │ view = providers/...  │
 │                         │                        ├──► ProvidersView       │
 │  Esc                    │                        │                       │
 ├────────────────────────►│                        │ back → menu view      │
 │                         │                        │                       │
 │  Save & Exit            │                        │                       │
 ├────────────────────────►│                        │ view = confirm        │
 │                         │                        ├──► ConfirmModal        │
 │  Enter                  │                        │ commit(config.json)   │
 │                         │                        ├──────────────────────►│
 │                         │ onComplete             │                       │
 │                         │◄───────────────────────┤                       │
 │                         │ refreshSettings()      │                       │
 │                         │ notice = "Saved"       │                       │
 │                         │ 停留 Configure          │                       │
```

### 未保存退出

```text
Configure 视图
  │
  ├─ Esc / Back
  │     └─ dispatch(quit-request)
  │           └─ WizardQuitConfirm
  │                 ├─ Cancel → 返回 Configure
  │                 └─ Quit   → MenuApp.onAbort → Home
  │
  └─ Save & Exit → ConfirmModal → commit → onComplete → Configure + Saved
```

---

## 5. Theme 预览数据流

```text
ThemeView
  │ 选择 theme
  ├── dispatch({ type: "theme-submit", theme })
  │        │
  │        ▼
  │   wizardReducer
  │        ├─ wizard.theme = theme
  │        └─ view = menu
  │
  ├── WizardApp useEffect → chrome.onThemeChange(wizard.theme)
  │        └─ MenuApp setTheme → 外层唯一 ThemeProvider 立即重绘 shell
  │
  └── Save & Exit
           └─ commit() → config.json.tui.theme
```

说明：

- Theme 预览仍是 wizard state 驱动，不直接写 config.json。
- embedded WizardApp 不嵌套 ThemeProvider；外层 MenuApp ThemeProvider 是唯一主题源。
- Core 运行中的主题重载由既有 `reloadConfig` 修复覆盖，不在本目标内重复实现。

---

## 6. 响应式布局分支

```text
terminal width
     │
     ├─ >= 80 ──► 左右分栏
     │              ├─ 左：MenuScreen 列表
     │              └─ 右：MenuPreviewPane
     │
     ├─ 64–79 ──► 单列 + 内联 detail
     │              └─ 不渲染右栏
     │
     └─ < 64 ───► 单列精简
                    ├─ 隐藏 detail
                    ├─ 标题/版本按 stringWidth 截断
                    └─ workspace 中部省略
```

所有宽度判断复用：

- `menuContentWidth(width)`
- `truncateByWidth()`
- `truncateMiddle()`
- `stringWidth()`

---

## 7. 风险热区

| 区域 | 风险 | 缓解 |
|---|---|---|
| `WizardApp` embedded | 路由切换卸载导致未保存 wizard state 丢失 | Workspace 编辑用覆盖层；Configure 路由保持 mounted |
| `MenuModal` 删除 | 测试、first-run、wizard view 引用遗漏 | 先迁移 `buildMenuItems` / `describeSelection`，再删除；全量 rg |
| Providers/Theme 分栏 | 键盘/焦点/滚动回归 | 复用 `MenuScreen`，补 PTY 与渲染测试 |
| GatewayModal | 内部状态机多，视觉改造误伤行为 | 只改 chrome，不改 actions / fetch / form 逻辑 |
| 窄窗口 | 版本号、workspace、hint、长 label/detail 折行 | 继续用 shared `stringWidth`；MenuScreen 预截断 + SelectableRow `truncate`；100/64/40 PTY |
| Workspace 切换 | 旧 wizard state 写入新 sandbox | 确认后丢弃并重挂载 WizardApp；取消保持原 state |
| 路由删除 | `atom config gateway` 返回路径错乱 | breadcrumb 与 `gateway-real.back` 断言；PTY 覆盖 |
