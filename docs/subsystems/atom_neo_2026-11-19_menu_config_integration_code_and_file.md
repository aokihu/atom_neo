# Atom Neo — Menu 与 Config 整合：文件与代码

> 项目：`atom_neo`
> 日期：2026-11-19
> 开发目标：`menu_config_integration`
> 状态：**M1–M5 已实施**。本文列出实际修改/创建的文件、职责与接口；里程碑与测试见最终交付记录。
> 计划见 [plan](./atom_neo_2026-11-19_menu_config_integration_plan.md)，关系图见 [graph](./atom_neo_2026-11-19_menu_config_integration_graph.md)。

---

## 1. 改动总览

### 1.1 新增文件

| 阶段 | 文件 | 职责 |
|---|---|---|
| M1 | <code>src/packages/config-tui/src/menu/menu-app.tsx</code> | OpenTUI MenuApp 根组件、路由、workspace/theme/Gateway port state |
| M1 | <code>src/packages/config-tui/src/menu/menu-routes.ts</code> | 路由类型与无配置 Workspace 重定向 |
| M1 | <code>src/packages/config-tui/src/menu/menu-home.tsx</code> | Home 菜单 |
| M1 | <code>src/packages/config-tui/src/menu/menu-frame.tsx</code> | 列表窗口滚动、状态头、路径省略、表单/secret/确认 |
| M1 | <code>src/packages/config-tui/src/menu/menu-types.ts</code> | `MenuActions` / `SessionSummary` / `MenuLaunch` 契约 |
| M1 | <code>src/packages/config-tui/src/menu/start-menu-app.tsx</code> | TTY 检查、延迟 actions 工厂、renderer 生命周期与 retry 重入 |
| M1 | <code>src/packages/config-tui/src/menu/workspace-gate.tsx</code> | 顶级 Gateway 前的 Workspace 确认页（Enter / C / Esc） |
| M2 | <code>src/packages/config-tui/src/menu/session-view.tsx</code> | New / Continue / History / Core Server 入口 |
| M2 | <code>src/packages/config-tui/src/menu/history-view.tsx</code> | Session 列表、打开、删除确认、attached 保护 |
| M2 | <code>src/packages/config-tui/src/menu/core-server-view.tsx</code> | Start / Stop / Attach、Stop 后状态轮询 |
| M4 | <code>src/packages/config-tui/src/menu/backup-view.tsx</code> | Export / Import 表单、遮罩密码、明文警告 |
| M1 | <code>src/packages/config-tui/src/renderer-lifecycle.ts</code> | MenuApp/独立 Wizard 共用 renderer 关闭与 stream lease 等待 |
| M1 | <code>src/packages/config-tui/src/menu/README.md</code> | 目录摘要与路由说明 |
| M1 | <code>src/bootstrap/menu-actions.ts</code> | 只读配置适配器、Chat/Core/Backup/Gateway/Session 动作 |
| M1 | <code>src/bootstrap/menu-launch.ts</code> | MenuLaunch → BootArguments 映射与失败重试循环 |
| M2 | <code>src/packages/core/src/session/types.ts</code> | `SessionSummary.active` / `attached` DTO |

### 1.2 修改文件

| 阶段 | 文件 | 改动 |
|---|---|---|
| M1 | `src/packages/config-tui/src/index.ts` | 导出 `startMenuApp` |
| M1 | `src/main.ts` | `menu`/`config` 分流到 MenuApp；移除 `--config` 分支；失败 launch 重开菜单 |
| M1 | `src/bootstrap/cli.ts` | 新增 `config` 子命令；删除 `--config` flag |
| M1 | `src/bootstrap/menu-actions.ts` | 只读 config、workspace 规范化、settings 刷新、备份/会话动作 |
| M1 | `src/packages/config-tui/src/menu/start-menu-app.tsx` | MenuApp renderer 入口；TTY 检查；旧 plain menu 已移除 |
| M2 | `src/packages/core/src/session/persistence-service.ts` | `listSessions()` / `listTuiSessions()` 复用同一摘要逻辑 |
| M2 | `src/packages/core/src/http-router.ts` | Session API admin 鉴权、attachSession、受控 shutdown |
| M2 | `src/packages/core/src/server.ts` | 提供 shutdown 回调/管理入口 |
| M3 | `src/packages/config-tui/src/components/GatewayModal.tsx` | 支持从菜单路由打开；保留现有操作 |
| M3 | `src/packages/config-tui/src/components/WizardApp.tsx` | 作为 Advanced configuration 的子路由复用；Wizard 内 Gateway 明确复用同一 Modal |
| M3 | `src/packages/config-tui/src/app.tsx` | 独立 first-run/config wizard renderer；非 MenuApp 的首次配置入口 |
| M4 | `src/bootstrap/backup.ts` | 复用现有导出/导入函数，不改格式 |
| M5 | docs | startup-menu、first-run-wizard、configuration、index、README |

---

## 2. MenuApp 路由

### 2.1 路由类型

```ts
export type MenuRoute =
  | { name: "home" }
  | { name: "session" }
  | { name: "history" }
  | { name: "core-server" }
  | { name: "gateway-shortcut" }
  | { name: "configure" }
  | { name: "advanced" }
  | { name: "gateway-real"; back: "advanced" | "gateway-shortcut" | "configure" }
  | { name: "wizard"; view: "providers" | "theme"; back: "configure" | "advanced" }
  | { name: "backup" }
  | { name: "backup-export" }
  | { name: "backup-import" };
```

### 2.2 MenuApp 骨架

```tsx
export function MenuApp({ sandbox, actions, initialRoute = "home", initialError, onExit }: {
  sandbox: string;
  actions: MenuActions;
  initialRoute?: "home" | "configure" | "gateway";
  initialError?: string;
  onExit: (launch?: MenuLaunch) => void;
}) {
  const [route, setRoute] = useState<MenuRoute>(() => routeFor(initialRoute, actions.hasConfig(sandbox)));
  const [workspace, setWorkspace] = useState(sandbox);
  const [theme, setTheme] = useState(actions.theme);
  const [gatewayPort, setGatewayPort] = useState(actions.gatewayPort);
  const [error, setError] = useState(initialError ?? "");

  return (
    <ThemeProvider theme={theme}>
      {route.name === "gateway-shortcut" && (
        <WorkspaceGate
          workspace={workspace}
          onContinue={() => setRoute({ name: "gateway-real", back: "gateway-shortcut" })}
          onChange={() => setRoute({ name: "workspace", after: "gateway-shortcut" })}
          onBack={() => setRoute({ name: "home" })}
        />
      )}
      {route.name === "gateway-real" && (
        <GatewayModal
          sandbox={workspace}
          port={gatewayPort}
          gatewayActions={actions.gateway}
          onSubmit={(port) => { actions.setGatewayPort(port); setGatewayPort(port); }}
          onBack={() => setRoute({ name: "configure" })}
        />
      )}
      ...
    </ThemeProvider>
  );
}
```

`routeFor("gateway", hasConfig)` 只在 `hasConfig` 为 true 时直达 Gateway；否则进入 `{ name: "workspace", after: "gateway-real" }`，避免 `loadConfig` 副作用伪造“已配置”。
顶栏通过 `MenuChromeProvider` 注入 `breadcrumbFor(route)` 与 `startMenuApp` 参数传入的版本号，不复制版本常量；`@atom-neo/tui-kit` Modal 新增 `headerRight`，版本号与标题同一行右对齐，breadcrumb 在下一行。

### 2.3 WorkspaceGate

```tsx
export function WorkspaceGate({ workspace, onContinue, onChange, onBack }: {
  workspace: string;
  onContinue: () => void;
  onChange: () => void;
  onBack: () => void;
}) {
  useKeyboard((event) => {
    if (event.name === "c" && !event.ctrl && !event.meta) onChange();
  });

  return (
    <MenuScreen
      title="Gateway"
      workspace={workspace}
      items={[
        { key: "continue", label: "Continue to Gateway configuration" },
        { key: "change", label: "Change workspace ›" },
        { key: "back", label: "‹ Back" },
      ]}
      onSelect={(key) => key === "continue" ? onContinue() : key === "change" ? onChange() : onBack()}
      hint="Enter continue · C change · Esc back"
    >
      <text>Gateway configuration uses this workspace.</text>
      <text>{workspace}</text>
    </MenuScreen>
  );
}
```

---

## 3. CLI 子命令

### 3.1 `src/bootstrap/cli.ts`

```ts
export type ConfigRoute = "configure" | "gateway";

export type BootArguments = {
  ...
  menu: boolean;
  configRoute?: ConfigRoute;
  ...
};
```

解析：

```ts
const first = rawArgs[0];

if (first === "config") {
  const { values, positionals } = parseArgs({
    args: rawArgs.slice(1),
    options: { sandbox: { type: "string" }, help: { type: "boolean", short: "h" } },
    allowPositionals: true,
    strict: true,
  });
  if (positionals.length > 1) throw new Error("config accepts only optional 'gateway'");
  const route = positionals[0];
  if (route !== undefined && route !== "gateway") {
    throw new Error(`Unknown config target: ${route}`);
  }
  return baseArguments({
    configRoute: route === "gateway" ? "gateway" : "configure",
    sandbox: parseSandboxPath(values.sandbox ?? process.cwd()),
    sandboxExplicit: values.sandbox !== undefined,
  });
}
```

移除：

```ts
config: { type: "boolean", default: false }
gateway: { type: "boolean", default: false }
```

`atom --config` 被严格 parser 拒绝为未知 option。

### 3.2 `src/main.ts`

```ts
if (args.menu || args.configRoute) {
  const { startMenuApp } = await import("@atom-neo/config-tui");
  const { createMenuActions } = await import("./bootstrap/menu-actions");
  const { runMenuLoop } = await import("./bootstrap/menu-launch");
  await runMenuLoop(
    args,
    (error) => startMenuApp(args.sandbox, {
      actions: () => createMenuActions(args.sandbox, args.port),
      initialRoute: args.configRoute ?? "home",
      error,
    }),
    runApp,
  );
  return;
}
```

`createMenuActions` 在 TTY/route 判定后由工厂创建；失败 launch 由 `runMenuLoop` 写回 `initialError` 并重新打开 MenuApp。

### 3.3 Menu actions

```ts
export type MenuActions = {
  theme: string;
  gatewayPort: number;
  gateway: GatewayInstanceActions;
  hasConfig: (workspace: string) => boolean;
  validateWorkspace: (workspace: string) => string | undefined;
  setWorkspace: (workspace: string) => string;
  refreshSettings: () => { theme: string; gatewayPort: number };
  coreStatus: () => Promise<"online" | "offline">;
  coreTarget: () => Promise<{ host: string; port: number }>;
  coreStartTarget: () => { host: string; port: number };
  gatewayStatus: () => Promise<"online" | "offline">;
  listSessions: () => Promise<SessionSummary[]>;
  deleteSession: (sessionId: string) => Promise<void>;
  stopCore: () => Promise<void>;
  exportBackup: (input: BackupExportInput) => Promise<string>;
  importBackup: (input: BackupImportInput) => Promise<string>;
  validateBackupPassword: (password: string) => string | undefined;
  inspectBackup: (archive: string) => Promise<{ encrypted: boolean }>;
  setGatewayPort: (port: number) => void;
};
```

- MenuApp 只产生 `MenuLaunch`；`main.ts` 通过 `menu-launch.ts` 映射到现有 `runApp` 参数。
- `setWorkspace` 返回规范化绝对路径；`refreshSettings` 在 Wizard/端口/workspace 变化后重新读取。
- `stopCore` 通过受控 Core API 执行；`gateway` 复用 `createGatewayActions`。
- `listSessions` / `deleteSession` 自动附带 Core runtime admin token。

---

## 4. Session History API

### 4.1 `SessionPersistenceService`

```ts
export type SessionSummary = {
  sessionId: string;
  lastTuiUsedAt: number;
  initiator: SessionInitiator;
  status: string;
  active: boolean;
  attached: boolean;
};

listSessions(): SessionSummary[] {
  return this.#checkpoints.listSessionDirectories().flatMap((dir) => {
    const state = this.#checkpoints.readSessionState(
      this.#checkpoints.resolveCurrentGeneration(dir) ?? dir,
    );
    return state ? [{
      sessionId: state.sessionId,
      lastTuiUsedAt: state.lastTuiUsedAt ?? 0,
      initiator: state.initiator ?? { type: "unknown" },
      status: state.status,
      active: false,
      attached: false,
    }] : [];
  });
}
```

`SessionStore.listSessions()` 合并持久化与内存 session，并标记 `active`（任务 lease）与 `attached`（WS open 引用计数）。`listTuiSessions()` 复用 `listSessions()` 过滤，不再重复扫描目录。`SessionSummary` 定义在 `@atom-neo/shared`，Core 与 MenuApp 共用同一 DTO；`lastTuiUsedAt` 缺失时使用 0，不回退 `updatedAt`。

### 4.2 `http-router.ts`

```ts
if (url.pathname === `${API_PREFIX}sessions` && method === "GET") {
  const denied = requireAdmin(req, ctx, deps.adminToken, deps.allowRemoteAdmin);
  if (denied) return denied;
  return Response.json(sessionStore.listSessions());
}
```

`GET /api/sessions/:id` 与 `DELETE /api/sessions/:id` 同样要求 admin token。删除时 `active || attached` 返回 409 `Session is active or attached`；显式 History open 使用 `sessionStore.attachSession()` 准备 session，真正的 attached 引用由 WS handler 的 `open`/`close` 通过 `retain`/`detach` 成对管理。HTTP attach 持久化失败返回 500 且不标记 attached。

### 4.3 Core stop

```ts
if (url.pathname === `${API_PREFIX}admin/shutdown` && method === "POST") {
  const denied = requireAdmin(req, ctx, deps.adminToken, deps.allowRemoteAdmin);
  if (denied) return denied;
  queueMicrotask(() => void deps.requestShutdown());
  return Response.json({ ok: true });
}
```

要求：

- 先返回 200，再优雅关闭。
- 本机管理 Token。
- 关闭失败必须有日志；不能直接 `process.exit`。

---

## 5. Configure 与 Advanced

### 5.1 Configure 页面

```tsx
<MenuList
  title="Configure"
  items={[
    { key: "workspace", label: "Workspace path ›", detail: workspace },
    { key: "advanced", label: "Advanced configuration ›", detail: `Gateway port ${gatewayPort}` },
    { key: "back", label: "‹ Back" },
  ]}
/>
```

### 5.2 Advanced

```text
Providers & Models
Theme
Gateway ›   ← 真实入口
```

- `Providers & Models` / `Theme` 路由到 `{ name: "wizard", view, back: "advanced" }`，保存/取消后返回 Advanced。
- `Gateway` 路由直接渲染 `GatewayModal`，不再经过 WorkspaceGate。
- Wizard 菜单内的 Gateway 项允许打开同一个 `GatewayModal`，返回 Wizard 菜单；测试 `menu-app.test.tsx` 覆盖，文档明确它不替代高级入口。
- `GatewayModal` 使用 `workspace` 作为 sandbox，`gatewayActions` 由 bootstrap 注入；端口保存后 MenuApp 立即更新 `gatewayPort` state。

### 5.3 复用 WizardApp

```tsx
{route.name === "wizard" && (
  <WizardApp
    sandboxPath={workspace}
    mode="config"
    initialView={route.view}
    gatewayActions={actions.gateway}
    onComplete={() => {
      const settings = actions.refreshSettings();
      setTheme(settings.theme);
      setGatewayPort(settings.gatewayPort);
      go({ name: route.back });
    }}
    onAbort={() => {
      const settings = actions.refreshSettings();
      setTheme(settings.theme);
      setGatewayPort(settings.gatewayPort);
      go({ name: route.back });
    }}
  />
)}
```

要求：

- 不嵌套 ThemeProvider 之外的额外 full-screen 容器。
- 返回后刷新 theme / Gateway port；Advanced 打开的 Wizard 返回 Advanced。
- 取消不写配置。

---

## 6. Backup

```tsx
{route.name === "backup-export" && (
  <BackupForm
    mode="export"
    workspace={workspace}
    onSubmit={(options) => actions.exportBackup(options)}
    onBack={() => setRoute({ name: "backup" })}
  />
)}
```

- 端口编辑只校验 1–65535，在原始 config 上合并 `gateway.port`，保留未知顶层/嵌套字段；写盘固定 0600。损坏的 `config.json` 返回 `Invalid config.json: ...`，由 `GatewayModal` 内联展示。
- Core 已在线时 Start Server 拒绝并提示使用 Attach Server；失败 launch 重试使用最后一次 launch 的 workspace。
- WS `open` 仅在 SessionReady 发送成功后 `retain`，`close` 调用 `detach`。
- Export：输出路径 → 遮罩密码（非空至少 8 位 + 二次确认）→ 空密码明文警告 → 写归档。
- Import：归档路径 → `inspectBackupArchive`（仅加密归档询问遮罩密码）→ merge/replace → 覆盖确认。
- 复用 `src/bootstrap/backup.ts` 的 `validateBackupPassword` / `inspectBackupArchive` / plan/execute 逻辑，不复制规则。

---

## 7. 测试文件

| 测试 | 覆盖 |
|---|---|
| `config-tui/src/menu/menu-app.test.tsx` | Home、路由、WorkspaceGate C、theme/port 刷新、Wizard 返回、失败反馈、Quit |
| `config-tui/src/menu/menu-views.test.tsx` | 长列表滚动、长路径省略、History 空/删除确认/attached 保护、Core start/stop/attach |
| `config-tui/src/menu/backup-view.test.tsx` | 遮罩密码、短密码拒绝、二次确认、明文警告、加密导入、取消 |
| `bootstrap/cli.test.ts` | `atom config`、`atom config gateway`、`--config` 拒绝 |
| `bootstrap/menu-actions.test.ts` | 只读空目录、workspace 规范化、settings、Session/Backup/Core 适配器 |
| `bootstrap/menu-launch.test.ts` | chat/core/attach 映射、失败重试、菜单取消 |
| `core/session/persistence-service.test.ts` | listSessions、attached 保护、持久化合并 |
| `core/http-router.test.ts` | Session API admin 鉴权、attached 409、shutdown |
| PTY `startup.integration.test.ts` | 新菜单导航、Workspace gate、config 取消/保存、Backup 导出/导入、History/Core stop、失败重试、窄窗口、非 TTY/`--config` 拒绝 |

所有 UI 测试使用 fake actions，不访问真实 Core/Gateway/Telegram。

---

## 8. 文档更新

- `docs/subsystems/startup-menu.md`
- `docs/subsystems/first-run-wizard.md`
- `docs/subsystems/configuration.md`
- `docs/overview/bootstrap.md`
- `docs/communication/gateway.md`
- `docs/index.md`
- `src/bootstrap/README.md`
- `src/packages/config-tui/README.md`
- 新 <code>src/packages/config-tui/src/menu/README.md</code>

---

## 9. 实施顺序

```text
M1 MenuApp 骨架
  → M2 Session + Core API
  → M3 Configure/Advanced/Gateway 路由
  → M4 Backup
  → M5 CLI 收口、PTY、文档
```

每阶段先更新文档与测试，再实现；每阶段运行 typecheck、docs:check 和定向测试。

---

## 10. 已确认并实施

- [x] MenuApp 放在 `@atom-neo/config-tui` 而非新包
- [x] `atom config` / `atom config gateway` 为唯一配置入口
- [x] `GET /api/sessions` 与受控 shutdown
- [x] History 第一版使用 sessionId/摘要
- [x] MenuApp 与 WizardApp 的路由级复用方式
- [x] 审查修复：只读 config、Backup 密码、attached 删除保护、Session API 鉴权、失败重试、长列表/长路径、PTY 覆盖
