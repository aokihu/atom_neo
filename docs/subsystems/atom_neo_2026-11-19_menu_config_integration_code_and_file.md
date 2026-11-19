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
| M1 | <code>src/packages/config-tui/src/menu/menu-app.tsx</code> | OpenTUI MenuApp 根组件、路由与全局 workspace |
| M1 | <code>src/packages/config-tui/src/menu/menu-routes.ts</code> | 路由类型、面包屑、菜单项定义 |
| M1 | <code>src/packages/config-tui/src/menu/menu-home.tsx</code> | Home 菜单 |
| M1 | <code>src/packages/config-tui/src/menu/workspace-gate.tsx</code> | 顶级 Gateway 前的 Workspace 确认页 |
| M2 | <code>src/packages/config-tui/src/menu/session-view.tsx</code> | New / Continue / History / Core Server 入口 |
| M2 | <code>src/packages/config-tui/src/menu/history-view.tsx</code> | Session 列表、打开、删除 |
| M2 | <code>src/packages/config-tui/src/menu/core-server-view.tsx</code> | Start / Stop / Attach |
| M3 | <code>src/packages/config-tui/src/menu/configure-view.tsx</code> | Workspace path + Advanced configuration |
| M3 | <code>src/packages/config-tui/src/menu/advanced-config-view.tsx</code> | 复用现有 config wizard 的路由入口 |
| M3 | <code>src/packages/config-tui/src/menu/gateway-view.tsx</code> | 顶级 Gateway 快捷入口 + 真实入口跳转 |
| M4 | <code>src/packages/config-tui/src/menu/backup-view.tsx</code> | Export / Import 表单 |
| M1 | <code>src/packages/config-tui/src/menu/README.md</code> | 目录摘要与路由说明 |
| M1 | <code>src/bootstrap/menu-actions.ts</code> | Chat/Core/Backup/Gateway 动作适配器 |
| M1 | <code>src/packages/core/src/session/session-summary.ts</code> | Session 列表摘要类型与读取辅助 |

### 1.2 修改文件

| 阶段 | 文件 | 改动 |
|---|---|---|
| M1 | `src/packages/config-tui/src/index.ts` | 导出 `startMenuApp` |
| M1 | `src/main.ts` | `menu`/`config` 分流到 MenuApp；移除 `--config` 分支 |
| M1 | `src/bootstrap/cli.ts` | 新增 `config` 子命令；删除 `--config` flag |
| M1 | `src/bootstrap/menu-actions.ts` | MenuApp 的 bootstrap 动作适配器 |
| M1 | `src/packages/config-tui/src/menu/start-menu-app.tsx` | MenuApp renderer 入口；旧 plain menu 已移除 |
| M2 | `src/packages/core/src/session/persistence-service.ts` | 增加 `listSessions()` |
| M2 | `src/packages/core/src/http-router.ts` | `GET /api/sessions`；受控 shutdown |
| M2 | `src/packages/core/src/server.ts` | 提供 shutdown 回调/管理入口 |
| M3 | `src/packages/config-tui/src/components/GatewayModal.tsx` | 支持从菜单路由打开；保留现有操作 |
| M3 | `src/packages/config-tui/src/components/WizardApp.tsx` | 作为 Advanced configuration 的子路由复用 |
| M3 | `src/packages/config-tui/src/app.tsx` | 支持初始路由/回调 |
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
  | { name: "gateway-real" }
  | { name: "backup" }
  | { name: "backup-export" }
  | { name: "backup-import" };
```

### 2.2 MenuApp 骨架

```tsx
export function MenuApp({ sandbox, actions, initialRoute = "home", onExit }: {
  sandbox: string;
  actions: MenuActions;
  initialRoute?: "home" | "configure" | "gateway";
  onExit: (request?: MenuRequest) => void;
}) {
  const [route, setRoute] = useState<MenuRoute>(() => routeFor(initialRoute));
  const [workspace, setWorkspace] = useState(sandbox);

  return (
    <ThemeProvider theme={actions.theme}>
      <MenuFrame workspace={workspace} route={route}>
        {route.name === "home" && <MenuHome ... />}
        {route.name === "gateway-shortcut" && (
          <WorkspaceGate
            workspace={workspace}
            onContinue={() => setRoute({ name: "gateway-real" })}
            onChange={() => setRoute({ name: "configure" })}
            onBack={() => setRoute({ name: "home" })}
          />
        )}
        {route.name === "gateway-real" && (
          <GatewayModal
            sandbox={workspace}
            port={actions.gatewayPort}
            gatewayActions={actions.gateway}
            onSubmit={actions.setGatewayPort}
            onBack={() => setRoute({ name: "advanced" })}
          />
        )}
        ...
      </MenuFrame>
    </ThemeProvider>
  );
}
```

### 2.3 WorkspaceGate

```tsx
export function WorkspaceGate({ workspace, onContinue, onChange, onBack }: {
  workspace: string;
  onContinue: () => void;
  onChange: () => void;
  onBack: () => void;
}) {
  return (
    <MenuList
      title="Gateway 配置快捷入口"
      selectedKey="open"
      items={[
        { key: "open", label: "Continue to Gateway configuration" },
        { key: "change", label: "Change workspace ›" },
        { key: "back", label: "‹ Back" },
      ]}
      onSelect={(key) => key === "open" ? onContinue() : key === "change" ? onChange() : onBack()}
      header={`Workspace\n${workspace}`}
      hint="Enter continue · C change · Esc back"
    />
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
  const actions = createMenuActions(args.sandbox);
  await startMenuApp(args.sandbox, {
    initialRoute: args.configRoute ?? "home",
    actions,
  });
  return;
}
```

### 3.3 Menu actions

```ts
export type MenuActions = {
  theme: string;
  gatewayPort: number;
  gateway: GatewayInstanceActions;
  runChat: (continueSession: boolean) => MenuRequest;
  startCore: (host: string, port: number) => MenuRequest;
  stopCore: () => Promise<void>;
  attach: (host: string, port: number) => MenuRequest;
  listSessions: () => Promise<SessionSummary[]>;
  deleteSession: (id: string) => Promise<void>;
  exportBackup: (options: BackupOptions) => Promise<void>;
  importBackup: (options: BackupOptions) => Promise<void>;
  setGatewayPort: (port: number) => void;
  setWorkspace: (path: string) => void;
};
```

- `runChat` / `startCore` / `attach` 返回 `MenuRequest`，MenuApp 关闭后由 `main.ts` 执行现有 `runApp`。
- `stopCore` 通过受控 Core API 或管理入口执行。
- `gateway` 复用 `createGatewayActions`。

---

## 4. Session History API

### 4.1 `SessionPersistenceService`

```ts
export type SessionSummary = {
  sessionId: string;
  lastTuiUsedAt: number;
  initiator: SessionInitiator;
  status: string;
  messages: number;
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
      messages: 0,
    }] : [];
  });
}
```

### 4.2 `http-router.ts`

```ts
if (url.pathname === `${API_PREFIX}sessions` && method === "GET") {
  return Response.json(sessionStore.listSessions());
}
```

`DELETE /api/sessions/:id` 保持现有 409 active 保护。

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
    { key: "workspace", label: "Workspace path ›" },
    { key: "advanced", label: "Advanced configuration ›" },
    { key: "back", label: "‹ Back" },
  ]}
  header={`workspace: ${workspace}`}
/>
```

### 5.2 Advanced

```text
Providers & Models
Theme
Gateway ›   ← 真实入口
```

- `Providers & Models` / `Theme` 路由到现有 config wizard；保存后返回 Advanced。
- `Gateway` 路由直接渲染 `GatewayModal`，不再经过 WorkspaceGate。
- `GatewayModal` 使用 `workspace` 作为 sandbox，`gatewayActions` 由 bootstrap 注入。

### 5.3 复用 WizardApp

```tsx
{route.name === "advanced" && (
  <WizardApp
    sandboxPath={workspace}
    mode="config"
    initialView="menu"
    gatewayActions={actions.gateway}
    onComplete={() => setRoute({ name: "configure" })}
    onAbort={() => setRoute({ name: "configure" })}
  />
)}
```

要求：

- 不嵌套 ThemeProvider 之外的额外 full-screen 容器。
- 返回后刷新 workspace / Gateway 状态。
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

- Export：输出路径、可选密码。
- Import：归档路径、merge/replace、覆盖确认。
- 复用 `src/bootstrap/backup.ts` 的 plan/execute 逻辑，不复制归档实现。

---

## 7. 测试文件

| 测试 | 覆盖 |
|---|---|
| `config-tui/src/menu/menu-app.test.tsx` | Home、路由、Esc、Quit、workspace header |
| `config-tui/src/menu/workspace-gate.test.tsx` | Continue/Change/Back、无效 workspace |
| `config-tui/src/menu/history-view.test.tsx` | 空列表、打开、删除、active 409 |
| `config-tui/src/menu/core-server-view.test.tsx` | start/stop/attach 状态 |
| `config-tui/src/menu/configure-view.test.tsx` | Workspace + Advanced |
| `config-tui/src/menu/backup-view.test.tsx` | Export/Import、确认 |
| `bootstrap/cli.test.ts` | `atom config`、`atom config gateway`、`--config` 拒绝 |
| `bootstrap/menu-actions.test.ts` | Chat/Core/Backup/Gateway 适配器 |
| `core/session/persistence-service.test.ts` | listSessions |
| `core/http-router.test.ts` | GET /api/sessions、shutdown |
| PTY `startup.integration.test.ts` | 新菜单导航、workspace gate、历史、窄窗口、非 TTY |

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

## 10. 待确认

- [ ] 接受 MenuApp 放在 `@atom-neo/config-tui` 而非新包
- [ ] 接受 `atom config` / `atom config gateway`
- [ ] 接受 `GET /api/sessions` 与受控 shutdown
- [ ] 接受 History 第一版使用 sessionId/摘要
- [ ] 接受 MenuApp 与 WizardApp 的路由级复用方式

确认后开始 M1。
