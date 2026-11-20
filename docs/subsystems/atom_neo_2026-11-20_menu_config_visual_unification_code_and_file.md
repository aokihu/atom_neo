# Atom Neo — Menu 与 Config 视觉统一文件与代码

> 项目：`atom_neo`
> 日期：2026-11-20
> 开发目标：`menu_config_visual_unification`
> 状态：**M1–M5 已实施**。
>
> 计划见 [plan](./atom_neo_2026-11-20_menu_config_visual_unification_plan.md)；
> 关系图见 [graph](./atom_neo_2026-11-20_menu_config_visual_unification_graph.md)。

---

## 1. 文件影响面

| 文件 | 动作 | 说明 |
|---|---|---|
| `src/packages/config-tui/src/menu/menu-frame.tsx` | 修改 | `MenuScreen` 增加左右分栏、`preview`、响应式；抽取共享右侧详情渲染 |
| `src/packages/config-tui/src/menu/menu-app.tsx` | 修改 | 移除 Advanced/Wizard 路由；Configure 渲染 embedded `WizardApp`；Workspace 编辑改为覆盖层 |
| `src/packages/config-tui/src/menu/menu-routes.ts` | 修改 | 扁平化 Configure；移除 `advanced` / `wizard`；更新 breadcrumb |
| `config-tui/src/menu/configure-view.tsx`（新建） | 新建 | Configure 左导航 + 右详情；复用 wizard state/dispatch |
| `src/packages/config-tui/src/components/WizardApp.tsx` | 修改 | 增加 embedded `chrome` 模式；配置模式不再渲染独立背景 |
| `components/MenuModal.tsx` | 删除 | 能力迁移到 `menu/configure-view.tsx`，避免两套菜单 |
| `src/packages/config-tui/src/wizard/WizardViews.tsx` | 修改 | `view.kind === "menu"` 不再由 WizardViews 渲染；改由 Configure 路由渲染 |
| `src/packages/config-tui/src/components/ProvidersModal.tsx` | 修改 | 迁移到统一分栏列表 + 右侧详情 |
| `src/packages/config-tui/src/components/ThemeModal.tsx` | 修改 | 迁移到统一分栏列表 + 色块预览 |
| `src/packages/config-tui/src/components/ProfilesModal.tsx` | 修改 | 统一标题、宽度、hint、版本号 |
| `src/packages/config-tui/src/components/DecisionsModal.tsx` | 修改 | 统一 chrome；保持字段与行为 |
| `src/packages/config-tui/src/components/GatewayModal.tsx` | 修改 | 保持 clients/actions 行为；统一标题/hint/版本号与分栏视觉 |
| `src/packages/config-tui/src/menu/backup-view.tsx` | 修改 | 表单/确认统一 chrome 与宽度 |
| `src/packages/config-tui/src/menu/menu-app.test.tsx` | 修改 | 新首页/Configure/路由/窄窗口断言 |
| `src/packages/config-tui/src/menu/menu-views.test.tsx` | 修改 | Session/History/Core/Backup 分栏预览断言 |
| `components/MenuModal.test.ts` | 删除/替换 | 迁移为 `menu/configure-view.test.tsx` |
| `src/packages/config-tui/src/wizard/wizard-view.test.ts` | 修改 | menu view 归属变化 |
| `src/bootstrap/startup.integration.test.ts` | 修改 | PTY：100/64/40 列、`atom menu` / `atom config` 落点 |
| `docs/subsystems/startup-menu.md` | 修改 | 新视觉、路由、CLI 快捷入口 |
| `docs/subsystems/first-run-wizard.md` | 修改 | embedded 模式与 first-run 的边界 |
| `docs/subsystems/configuration.md` | 修改 | Configure 扁平化后的设置入口 |
| `src/packages/config-tui/README.md` | 修改 | menu/ 目录文件与测试清单 |
| `src/packages/config-tui/src/menu/README.md` | 修改 | 新 `configure-view.tsx`、测试清单 |

不新增：
- 不新增全局状态库。
- 不复制 wizard reducer。
- 不新增第二套 Modal 组件。
- 不修改 Gateway/Backup/Core 后端契约。

---

## 2. 路由模型

### 2.1 目标 `MenuRoute`

```ts
export type MenuRoute =
  | { name: "home" }
  | { name: "session" }
  | { name: "history" }
  | { name: "core-server" }
  | { name: "gateway-shortcut" }
  | { name: "gateway-real"; back: "gateway-shortcut" | "configure" }
  | { name: "configure" }
  | { name: "workspace"; after: "configure" | "gateway-shortcut" | "gateway-real" }
  | { name: "backup" }
  | { name: "backup-export" }
  | { name: "backup-import" };
```

删除：

- `advanced`
- `wizard`

Providers / Profiles / Decisions / Theme 不再由 MenuApp 顶层路由持有，而是 Configure 内 wizard state 的视图。

### 2.2 Breadcrumb

```ts
export function breadcrumbFor(route: MenuRoute): string | undefined {
  switch (route.name) {
    case "home": return undefined;
    case "session": return "Home / Session";
    case "history": return "Home / Session / History";
    case "core-server": return "Home / Session / Core Server";
    case "gateway-shortcut": return "Home / Gateway";
    case "gateway-real":
      return route.back === "gateway-shortcut" ? "Home / Gateway / Configuration" : "Home / Configure / Gateway";
    case "configure": return "Home / Configure";
    case "workspace":
      return route.after === "gateway-shortcut" ? "Home / Gateway / Workspace"
        : route.after === "gateway-real" ? "Gateway / Workspace"
          : "Home / Configure / Workspace";
    case "backup": return "Home / Backup";
    case "backup-export": return "Home / Backup / Export";
    case "backup-import": return "Home / Backup / Import";
  }
}
```

### 2.3 CLI 初始路由

| 命令 | 初始路由 |
|---|---|
| `atom menu` | `{ name: "home" }` |
| `atom config` | `{ name: "configure" }` |
| `atom config gateway` + 有 config | `{ name: "gateway-real", back: "configure" }` |
| `atom config gateway` + 无 config | `{ name: "workspace", after: "gateway-real" }` |

---

## 3. `MenuScreen` 分栏改造

### 3.1 新增类型

```ts
export type MenuPreview = {
  title: string;
  lines: string[];
};

type MenuScreenProps = {
  // 现有字段保持不变
  preview?: (item: MenuItem) => MenuPreview;
};
```

### 3.2 布局结构

```tsx
<Modal ...>
  <box flexDirection="column">
    <MenuStatus workspace={workspace} gateway={gateway} core={core} />
    {children}
    {width >= SPLIT_MIN_WIDTH ? (
      <box flexDirection="row" flexGrow={1}>
        <box width={NAV_WIDTH} flexDirection="column">
          {visibleItems.map(...)}
        </box>
        <box
          flexGrow={1}
          border={["left"]}
          borderStyle="single"
          borderColor={colors.border.default}
          paddingLeft={2}
          flexDirection="column"
        >
          <MenuPreviewPane preview={selectedPreview} />
        </box>
      </box>
    ) : (
      <SingleColumnItems ... />
    )}
    {error ? ... : null}
    {notice ? ... : null}
  </box>
</Modal>
```

### 3.3 默认 preview

```tsx
function defaultPreview(item: MenuItem, hint: string): MenuPreview {
  return {
    title: item.label.replace(/[›‹]\s*/g, "").trim().toUpperCase(),
    lines: [item.detail ?? "", "", hint],
  };
}
```

规则：

- `width >= 80` 显示左右分栏。
- `64–79` 只显示单列列表，detail 内联。
- `< 64` 隐藏 detail。
- 继续使用 `truncateByWidth` / `truncateMiddle` / `stringWidth`。
- 长列表仍使用 10 行窗口与 `x-y of n`。

---

## 4. Configure 页面

### 4.1 新建 `menu/configure-view.tsx`

```tsx
import { MenuScreen } from "./menu-frame";
import type { MenuItem, MenuPreview } from "./menu-frame";
import type { WizardAction, WizardUiState } from "../wizard/wizard-reducer";
// buildMenuItems / describeSelection are defined in this same file.

export type ConfigureMenuProps = {
  ui: WizardUiState;
  dispatch: (action: WizardAction) => void;
  workspace: string;
  gateway: "online" | "offline" | "unknown";
  core: "online" | "offline" | "unknown";
  suspended?: boolean;
  onWorkspace: () => void;
  notice?: string;
  error?: string;
};

export function ConfigureView({ ui, dispatch, ...props }: ConfigureMenuProps) {
  const items: MenuItem[] = [
    { key: "workspace", label: "Workspace path", detail: props.workspace },
    ...buildMenuItems(ui.wizard).map(item => ({ key: item.value, label: item.label })),
    { key: "back", label: "‹ Back" },
  ];

  const preview = (item: MenuItem): MenuPreview => {
    if (item.key === "workspace") {
      return { title: "WORKSPACE PATH", lines: [props.workspace, "", "config.json · .env · .atom"] };
    }
    if (item.key === "back") {
      return { title: "BACK", lines: ["Return to Home.", "", "Esc back"] };
    }
    return {
      title: item.label.toUpperCase(),
      lines: describeSelection(item.key as any, ui.wizard),
    };
  };

  return (
    <MenuScreen
      title="Configure"
      workspace={props.workspace}
      gateway={props.gateway}
      core={props.core}
      items={items}
      preview={preview}
      suspended={props.suspended}
      onSelect={key => {
        if (key === "workspace") props.onWorkspace();
        else if (key === "back") dispatch({ type: "quit-request" });
        else dispatch({ type: "menu-select", key: key as any });
      }}
      onBack={() => dispatch({ type: "quit-request" })}
      hint="↑/↓ move · Enter open · Esc back"
    />
  );
}
```

说明：

- `buildMenuItems` / `describeSelection` 从 `MenuModal.tsx` 迁移到 `configure-view.tsx`，原文件删除。
- 不再出现 `Advanced configuration`。
- `save` 项仍由 wizard reducer 转到 `confirm` 视图。
- `back` 使用 `quit-request`，由 `WizardQuitConfirm` 处理未保存确认。

### 4.2 Workspace 编辑覆盖层

Workspace 编辑不能切换到 MenuApp 顶层 `workspace` 路由，否则 `WizardApp` 会被卸载，未保存的 wizard state 丢失。

```tsx
const [workspaceEditing, setWorkspaceEditing] = useState(false);
const [pendingWorkspace, setPendingWorkspace] = useState<string>();

<WizardApp
  key={workspace}
  chrome={{
    workspace,
    gateway,
    core,
    suspended: workspaceEditing || Boolean(pendingWorkspace),
    onWorkspace: () => setWorkspaceEditing(true),
    onThemeChange: setTheme,
  }}
/>

{workspaceEditing ? (
  <MenuPrompt
    title="Configure / Workspace"
    label="Workspace path"
    value={workspace}
    onSubmit={value => {
      const problem = actions.validateWorkspace(value);
      if (problem) return setError(problem);
      const target = actions.normalizeWorkspace(value);
      setWorkspaceEditing(false);
      if (target === workspace) return;
      setPendingWorkspace(target);
    }}
    onCancel={() => setWorkspaceEditing(false)}
    hint="Enter continue · Esc cancel"
  />
) : null}

{pendingWorkspace ? (
  <MenuConfirm
    title="Switch workspace"
    message="Switch workspace? Unsaved Configure changes will be discarded."
    confirmLabel="Switch"
    onConfirm={() => {
      actions.setWorkspace(pendingWorkspace);
      const settings = actions.refreshSettings();
      setWorkspace(pendingWorkspace);
      setTheme(settings.theme);
      setGatewayPort(settings.gatewayPort);
      setPendingWorkspace(undefined);
    }}
    onCancel={() => setPendingWorkspace(undefined)}
  />
) : null}
```

---

## 5. `WizardApp` embedded 模式

### 5.1 新 props

```ts
export type WizardChrome = {
  workspace: string;
  gateway: "online" | "offline" | "unknown";
  core: "online" | "offline" | "unknown";
  suspended?: boolean;
  onWorkspace: () => void;
  onThemeChange?: (theme: string) => void;
  notice?: string;
  error?: string;
};

export function WizardApp({
  sandboxPath, mode, initialView, gatewayActions, onComplete, onAbort, chrome,
}: {
  sandboxPath: string;
  mode: WizardMode;
  initialView?: WizardInitialView;
  gatewayActions?: GatewayInstanceActions;
  onComplete: () => void;
  onAbort: () => void;
  chrome?: WizardChrome;
}) { ... }
```

### 5.2 渲染分支

```tsx
const embedded = mode === "config" && chrome !== undefined;

useEffect(() => {
  if (embedded) chrome?.onThemeChange?.(wizard.theme);
}, [embedded, chrome?.onThemeChange, wizard.theme]);

const content = (
  <>
    {!embedded && <WizardBackground />}
    {view?.kind === "menu" && embedded && chrome ? (
      <ConfigureView
        ui={ui}
        dispatch={dispatch}
        workspace={chrome.workspace}
        gateway={chrome.gateway}
        core={chrome.core}
        suspended={chrome.suspended}
        onWorkspace={chrome.onWorkspace}
      />
    ) : null}
    <WizardProviderViews {...views} onModelsSubmit={submitModels} />
    <WizardSettingsViews {...views} ... onSave={save} />
    <WizardQuitConfirm
      open={ui.quitConfirm}
      onQuit={onAbort}
      onCancel={() => dispatch({ type: "quit-cancel" })}
    />
  </>
);

return embedded ? content : <ThemeProvider theme={wizard.theme}>{content}</ThemeProvider>;
```

### 5.3 `WizardViews` 调整

```tsx
// WizardProviderViews 不渲染 menu；配置模式的 menu 只由 ConfigureView 渲染。
{view?.kind === "providers" && <ProvidersModal ... />}
```

配置模式下 `view.kind === "menu"` 只由 `ConfigureView` 渲染；first-run 模式不会出现 menu 视图。

---

## 6. `MenuApp` 路由调整

### 6.1 Configure 路由

```tsx
) : route.name === "configure" ? (
  <WizardApp
    sandboxPath={workspace}
    mode="config"
    initialView="menu"
    gatewayActions={actions.gateway}
    onComplete={() => {
      const settings = actions.refreshSettings();
      setTheme(settings.theme);
      setGatewayPort(settings.gatewayPort);
      setNotice("Saved");
    }}
    onAbort={() => go({ name: "home" })}
    chrome={{
      workspace,
      gateway,
      core,
      suspended: workspaceEditing,
      onWorkspace: () => setWorkspaceEditing(true),
      onBack: () => go({ name: "home" }),
    }}
  />
) : route.name === "gateway-real" ? (
  <GatewayModal
    sandbox={workspace}
    port={gatewayPort}
    gatewayActions={actions.gateway}
    onSubmit={(port) => {
      actions.setGatewayPort(port);
      setGatewayPort(port);
    }}
    onBack={back}
  />
) : ...
```

### 6.2 删除

- `route.name === "advanced"` 分支。
- `route.name === "wizard"` 分支。
- Configure 页面的 `Workspace path / Advanced configuration` 列表。
- `menu-routes.ts` 中 `advanced` / `wizard` 类型与 breadcrumb。
- `MenuModal.tsx` 与 `MenuModal.test.ts`（能力迁移到 `configure-view.tsx`）。

### 6.3 保留

- `gateway-shortcut` + `WorkspaceGate`。
- `gateway-real` + `GatewayModal`。
- `workspace` 路由用于顶级 Gateway 快捷入口的 WorkspaceGate；Configure 内的 Workspace 编辑使用覆盖层。
- Session / History / Core / Backup 行为。

---

## 7. 设置列表视觉迁移

### 7.1 Providers

目标：

```text
╭─ ATOM NEO · Providers & Models ────────────────────────────── vX.Y.Z ─╮
│ Home / Configure / Providers & Models                                   │
│                                                                         │
│  ❯ deepseek            │  DEEPSEEK                                     │
│    openai              │  Models      deepseek-v4-flash, deepseek-r1   │
│    custom              │  API key     DEEPSEEK_API_KEY (set)           │
│    ＋ Add Provider      │  Thinking    enabled                          │
│    ‹ Back              │  Context     131072                           │
╰─────────────────────────────────────────────────────────────────────────╯
```

实现：

- 复用 `MenuScreen` 的 `preview`。
- 保留 `➕ Add Provider` 的输入流程，可继续使用 `FieldInput` 覆盖层。
- 删除 `ProvidersModal` 的独立 52 宽窗口，改为 shell 内列表。

### 7.2 Theme

```text
╭─ ATOM NEO · Theme ─────────────────────────────────────────── vX.Y.Z ─╮
│ Home / Configure / Theme                                                │
│                                                                         │
│  ❯ edex                │  THEME PREVIEW                               │
│    github-dark         │  ███  background   #05090c                   │
│    github-light        │  ███  text         #d6e0e5                   │
│    dracula             │  ███  accent       #63cbea                   │
│    nord                │                                              │
│    tokyo-night  current │  Applies immediately in this TUI.            │
│    solarized-dark      │  Saved to config.json on Save & Exit.        │
│    monokai             │                                              │
╰─────────────────────────────────────────────────────────────────────────╯
```

实现：

- `ThemeModal` 改为 shell 内列表 + `preview`。
- 色块使用主题真实颜色。
- 选择主题后立即 dispatch，保持当前即时预览行为。

### 7.3 Profiles / Decisions

- 保留表单结构，统一 Modal 宽度（64/72）、标题、hint。
- 标题行左侧 `ATOM NEO · <title>`，右侧版本号。
- 不改变字段、校验、提交行为。

### 7.4 Gateway

- 保留 `clients` / `actions` / `check` / `logs` / `edit` 等内部状态机。
- 列表页迁移为 shell 分栏：左侧 clients/actions，右侧详情。
- 表单和诊断视图统一 Modal chrome。
- 不改变 `gatewayAction`、`fetchGatewayInstances`、`GatewayInstanceForm`。

### 7.5 Backup

- Export / Import 列表使用 shell 分栏。
- 输入/密码/确认继续使用 `MenuPrompt` / `MenuSecretPrompt` / `MenuConfirm`。
- 密码遮罩、8 位、二次确认、明文警告不变。

---

## 8. 测试清单

### 8.1 单元/渲染

```text
menu-app.test.tsx
  - atom menu 初始 Home
  - atom config 初始 Configure
  - Configure 无 Advanced configuration
  - Configure 左导航项与 preview
  - Save & Exit 返回 Configure 并显示 Saved
  - Workspace 覆盖层不丢失 wizard state
  - gateway shortcut 仍走 WorkspaceGate
  - gateway-real 返回 Configure

menu-views.test.tsx
  - Session/History/Core/Backup 分栏与 preview
  - 长列表滚动
  - error/notice 位置

configure-view.test.tsx
  - buildMenuItems/describeSelection 迁移
  - workspace/back/save 映射
  - 选中项 preview 更新

wizard-view.test.ts
  - menu view 不再由 WizardViews 渲染
  - first-run 模式不受影响

providers/theme/profiles/decisions/gateway
  - 分栏/表单行为不回归
```

### 8.2 PTY

```text
100 列：Home / Configure / Theme / Gateway / Backup
64 列：左右分栏退化为单列，detail 内联
40 列：标题、版本、workspace、hint 不折行
atom menu → Home
atom config → Configure
atom config gateway（有/无 config）
Configure → Save & Exit
Configure → Back / Quit 确认
```

### 8.3 验证命令

```bash
bun test
ATOM_RUN_STARTUP_VALIDATION=1 bun test src/bootstrap/startup.integration.test.ts
bun run typecheck
bun run typecheck:node
bun run docs:check
git diff --check
```

---

## 9. 回滚策略

- 路由删除（`advanced` / `wizard`）与 `WizardApp` embedded 模式必须在同一个 commit 内完成，避免中间状态不可用。
- `MenuModal.tsx` 删除前先完成 `configure-view.tsx` 与测试迁移。
- 若 Providers/Theme 分栏迁移风险过高，可保留 Modal 但统一 chrome，作为 M3 的降级方案；不得阻塞 M1/M2 合并。

---

## 10. 验收命令与证据

- `git diff --stat`：确认只涉及本表文件。
- `bun test`：0 fail。
- PTY：100/64/40 帧内容断言。
- 手动：

```bash
./dist/atom menu
./dist/atom config
./dist/atom config gateway
```

确认三者进入同一视觉体系，且返回路径一致。

## 11. 复审修复补充

- `configure-view.tsx` 的 wizard 菜单项与 `describeSelection` 全部在本文件内，`MenuModal`/`LegacyMenuModal` 已删除。
- Workspace 切换使用 `MenuConfirm`：确认后 `setWorkspace` + `refreshSettings` + WizardApp key epoch 重挂载；取消不改变 workspace/state。
- `startWizard` 仅支持 `first-run`；embedded WizardApp 无背景、无嵌套 ThemeProvider，主题通过 `chrome.onThemeChange` 更新外层 MenuApp。
- 列表 label/detail 通过 `truncateByWidth` 预截断，`SelectableRow truncate` 保证单行；表单 chrome 统一到 Confirm/ApiKey/Models/Project/GatewayInstanceForm/WizardQuit。
