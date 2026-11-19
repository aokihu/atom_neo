# Atom Neo — Menu 与 Config 整合：关系图

> 项目：`atom_neo`
> 日期：2026-11-19
> 开发目标：`menu_config_integration`
> 状态：**M1–M5 已实施**
>
> 计划见 [plan](./atom_neo_2026-11-19_menu_config_integration_plan.md)，文件与示例代码见 [code_and_file](./atom_neo_2026-11-19_menu_config_integration_code_and_file.md)。

---

## 1. 系统上下文

```mermaid
graph TB
    User["用户"]
    CLI["atom menu / config / gateway"]
    Menu["MenuApp (OpenTUI)"]
    Wizard["WizardApp (config)"]
    GatewayModal["GatewayModal"]
    Actions["bootstrap/menu-actions"]
    Core["Core HTTP API"]
    Gateway["Gateway admin API"]
    Backup["bootstrap/backup"]

    User --> CLI
    CLI --> Menu
    Menu --> Wizard
    Menu --> GatewayModal
    Menu --> Actions
    Actions --> Core
    Actions --> Gateway
    Actions --> Backup
    Menu -->|Gateway actions| GatewayModal
```

---

## 2. CLI 路由

```mermaid
graph LR
    A["atom menu"] --> H["Home"]
    B["atom config"] --> C["Configure"]
    C["atom config gateway"] --> G["Advanced > Gateway"]
    D["atom gateway ..."] --> CLI["现有 Gateway CLI"]
    E["atom --config"] --> X["Rejected: unknown option"]
```

---

## 3. MenuApp 路由状态

```mermaid
stateDiagram-v2
    [*] --> home
    home --> session: Session
    home --> gateway_shortcut: Gateway
    home --> configure: Configure
    home --> backup: Backup
    home --> quit_confirm: Quit / Esc

    session --> history: History
    session --> core_server: Core Server
    session --> home: Back

    history --> session: Back
    core_server --> session: Back

    gateway_shortcut --> workspace_gate: open
    workspace_gate --> gateway_real: Continue
    workspace_gate --> configure: Change workspace
    workspace_gate --> home: Back
    gateway_real --> advanced: Back

    configure --> workspace: Workspace path
    configure --> advanced: Advanced configuration
    configure --> home: Back
    advanced --> wizard: Providers & Models / Theme
    advanced --> gateway_real: Gateway
    advanced --> configure: Back
    wizard --> advanced: Save / Cancel

    backup --> export: Export
    backup --> import: Import
    export --> backup: Back
    import --> backup: Back
    backup --> home: Back

    quit_confirm --> [*]: Quit
    quit_confirm --> home: Cancel
```

---

## 4. 模块依赖

```mermaid
graph TB
    subgraph ConfigTUI["@atom-neo/config-tui"]
        MenuApp["menu/menu-app.tsx"]
        MenuRoutes["menu/menu-routes.ts"]
        MenuTypes["menu/menu-types.ts"]
        MenuFrame["menu/menu-frame.tsx"]
        StartMenu["menu/start-menu-app.tsx"]
        Home["menu/menu-home.tsx"]
        WorkspaceGate["menu/workspace-gate.tsx"]
        SessionView["menu/session-view.tsx"]
        HistoryView["menu/history-view.tsx"]
        CoreView["menu/core-server-view.tsx"]
        BackupView["menu/backup-view.tsx"]
        Wizard["components/WizardApp.tsx"]
        StandaloneWizard["app.tsx"]
        GatewayModal["components/GatewayModal.tsx"]
        InstanceForm["components/GatewayInstanceForm.tsx"]
        Status["gateway-status.ts"]
        TuiKit["@atom-neo/tui-kit"]
    end

    subgraph Bootstrap["src/bootstrap"]
        StartMain["main.ts"]
        MenuLaunch["menu-launch.ts"]
        MenuActions["menu-actions.ts"]
        GatewayActions["gateway-actions.ts"]
        Backup["backup.ts"]
        Runtime["runtime-file.ts"]
    end

    subgraph Core["@atom-neo/core"]
        Router["http-router.ts"]
        Store["session/store.ts"]
        Sessions["session/persistence-service.ts"]
        Server["server.ts"]
    end

    StartMain --> StartMenu
    StartMain --> MenuLaunch
    StartMenu --> MenuApp
    MenuApp --> MenuRoutes
    MenuApp --> MenuTypes
    MenuApp --> MenuFrame
    MenuApp --> Home
    MenuApp --> WorkspaceGate
    MenuApp --> SessionView
    MenuApp --> HistoryView
    MenuApp --> CoreView
    MenuApp --> BackupView
    MenuApp --> Wizard
    StandaloneWizard --> Wizard
    MenuApp --> GatewayModal
    MenuApp --> TuiKit
    GatewayModal --> InstanceForm
    GatewayModal --> Status
    Wizard --> GatewayModal: 明确允许的第二入口
    MenuLaunch --> MenuTypes
    MenuActions --> MenuTypes
    MenuActions --> GatewayActions
    MenuActions --> Backup
    MenuActions --> Runtime
    MenuActions --> Router
    Router --> Store
    Router --> Sessions
    Server --> Router
```

**边界**

- `config-tui` 不导入 `bootstrap`；动作通过 `MenuActions` 注入。
- `bootstrap` 可以导入 `config-tui`、`core` 和 `gateway`。
- `GatewayModal` 不直接读写 config；配置写入通过 shared `client-instance` / `gateway-actions`。
- `WizardApp` 作为独立路由复用，不复制 provider/model 表单。

---

## 5. `atom menu` 启动序列

```mermaid
sequenceDiagram
    participant Main as src/main.ts
    participant CLI as bootstrap/cli.ts
    participant Menu as config-tui MenuApp
    participant Actions as bootstrap/menu-actions
    participant Gateway as Gateway API
    participant Core as Core API

    Main->>CLI: parseArguments(["menu"])
    CLI-->>Main: menu=true, sandbox
    Main->>Menu: startMenuApp(sandbox, actionsFactory)
    Menu->>Menu: TTY check, then createMenuActions(sandbox, port)
    Menu->>Actions: read-only theme/Gateway port
    Menu->>Gateway: optional status
    Menu->>Core: optional session/core status
    Menu-->>Main: exit/quit 或 MenuLaunch
    Main->>Main: runMenuLoop → menuLaunchArguments → runApp
    Main-->>Menu: launch error → reopen with initialError
```

`MenuLaunch` 保留现有 `runApp` 执行路径：New Chat / Core Server / Attach 关闭 MenuApp 后由 `main.ts` 启动现有应用。失败 launch 不退出进程，而是重新打开菜单并显示 `Launch failed: ...`。

---

## 6. 顶级 Gateway 快捷入口

```mermaid
sequenceDiagram
    participant User
    participant Menu as MenuApp
    participant Gate as WorkspaceGate
    participant Modal as GatewayModal
    participant Actions as menu-actions
    participant GW as Gateway admin

    User->>Menu: Gateway
    Menu->>Gate: current workspace
    Gate-->>User: Continue / Change workspace / Back
    User->>Gate: Continue
    Gate->>Modal: open(sandbox=workspace)
    Modal->>Actions: fetchGatewayInstances
    Actions->>GW: GET /admin/clients
    GW-->>Actions: instances
    Actions-->>Modal: merged status
```

`Change workspace` 进入 `Configure → Workspace path`，保存后回到 `WorkspaceGate`。

---

## 7. 真实 Gateway 入口

```mermaid
sequenceDiagram
    participant User
    participant Menu as MenuApp
    participant Configure
    participant Advanced
    participant Modal as GatewayModal

    User->>Menu: Configure
    Menu->>Configure: open
    User->>Configure: Advanced configuration
    Configure->>Advanced: open
    User->>Advanced: Gateway
    Advanced->>Modal: open(sandbox=workspace)
    Note over Modal: 不再经过 WorkspaceGate
```

---

## 8. Session / History

```mermaid
sequenceDiagram
    participant User
    participant Menu as MenuApp
    participant Actions as menu-actions
    participant Core as Core API
    participant Chat as Chat TUI

    User->>Menu: Session > New Chat
    Menu->>Actions: runChat(false)
    Actions-->>Menu: MenuLaunch
    Menu-->>User: exit
    Actions->>Chat: start default TUI

    User->>Menu: Session > History
    Menu->>Actions: listSessions()
    Actions->>Core: GET /api/sessions
    Core-->>Actions: summaries
    Actions-->>Menu: list
    User->>Menu: Delete
    Menu->>Menu: MenuConfirm (cancel = no API call)
    Menu->>Actions: deleteSession(id)
    Actions->>Core: DELETE /api/sessions/:id + admin token
    Core->>Core: reject active || attached
    Core-->>Actions: 200 / 409 Session is active or attached
```

WS attach 生命周期：

```mermaid
sequenceDiagram
    participant TUI
    participant HTTP as Core HTTP
    participant Store as SessionStore
    participant WS as WS handler

    TUI->>HTTP: POST /api/tui/attach
    HTTP->>Store: attachSession/attachTui (persist, no retain)
    HTTP-->>TUI: sessionId
    TUI->>WS: open(sessionId)
    WS->>Store: retain(sessionId)
    Note over Store: attached count > 0
    TUI->>WS: close
    WS->>Store: detach(sessionId)
    Note over Store: count == 0 → sweep/evict/delete allowed
```

HTTP attach 失败（404/持久化 500）不会打开 WS，因此不会留下 attached。多个 WS 连接使用引用计数，最后一个 close 才释放保护。

---

## 9. Core Server Stop

```mermaid
sequenceDiagram
    participant User
    participant Menu as MenuApp
    participant Actions as menu-actions
    participant Core as Core HTTP
    participant Shutdown as Core shutdown

    User->>Menu: Core Server > Stop Server
    Menu->>Actions: stopCore()
    Actions->>Core: POST /api/admin/shutdown
    Core->>Core: validate admin token
    Core->>Shutdown: schedule graceful shutdown
    Core-->>Actions: 200 {ok:true}
    Actions-->>Menu: stopped
    Shutdown->>Shutdown: stop schedules/tasks/sessions
```

要求：

- 先返回响应，再关闭。
- 不直接 `kill`。
- 失败显示错误，不退出 menu。

---

## 10. Backup

```mermaid
sequenceDiagram
    participant User
    participant Menu as MenuApp
    participant View as BackupView
    participant Actions as menu-actions
    participant Backup as bootstrap/backup

    User->>Menu: Backup > Export
    Menu->>View: Export form
    User->>View: output → masked password → confirm
    alt empty password
        View-->>User: plaintext API-key warning
        User->>View: confirm
    end
    View->>Actions: validateBackupPassword / exportBackup
    Actions->>Backup: validate + plan/execute
    Backup-->>Actions: result
    Actions-->>View: success / error
```

Import 先 `inspectBackupArchive`，只有加密归档显示遮罩密码；`.env` merge/replace 与覆盖确认后才写盘；取消不写文件。

---

## 11. 数据模型

```mermaid
erDiagram
    MENU_STATE ||--o{ ROUTE : has
    MENU_STATE {
        string workspace
        string theme
        number gatewayPort
        string gatewayStatus
        string coreStatus
    }
    ROUTE {
        string name
        string breadcrumb
    }
    SESSION_SUMMARY ||--o{ SESSION : summarizes
    SESSION_SUMMARY {
        string sessionId
        number lastTuiUsedAt
        string initiator
        string status
        boolean active
        boolean attached
    }
    GATEWAY_INSTANCE ||--o{ SUPERVISOR : maps
    GATEWAY_INSTANCE {
        string id
        string source
        string state
        boolean registered
    }
```

---

## 12. 文件改动热区

```mermaid
graph TB
    subgraph M1["M1 MenuApp"]
        F1["config-tui/src/menu/menu-app.tsx"]
        F2["config-tui/src/menu/menu-routes.ts"]
        F3["config-tui/src/menu/menu-home.tsx"]
        F4["config-tui/src/menu/workspace-gate.tsx"]
        F5["bootstrap/menu-actions.ts"]
        F6["main.ts / cli.ts"]
    end

    subgraph M2["M2 Session"]
        F7["config-tui/src/menu/session-view.tsx"]
        F8["config-tui/src/menu/history-view.tsx"]
        F9["config-tui/src/menu/core-server-view.tsx"]
        F10["core/session/persistence-service.ts"]
        F11["core/http-router.ts"]
    end

    subgraph M3["M3 Configure/Gateway"]
        F12["config-tui/src/menu/menu-app.tsx"]
        F13["config-tui/src/menu/menu-routes.ts"]
        F14["config-tui/src/menu/workspace-gate.tsx"]
        F15["config-tui/src/components/GatewayModal.tsx"]
        F16["config-tui/src/components/WizardApp.tsx"]
    end

    subgraph M4["M4 Backup"]
        F17["config-tui/src/menu/backup-view.tsx"]
        F18["bootstrap/backup.ts"]
        F19["config-tui/src/menu/menu-frame.tsx"]
        F20["config-tui/src/menu/menu-types.ts"]
    end

    M1 --> M2 --> M3 --> M4
```

---

## 13. 测试关系

```mermaid
graph LR
    MenuTests["menu-app.test.tsx"] --> MenuApp
    ViewTests["menu-views.test.tsx"] --> WorkspaceGate
    ViewTests --> HistoryView
    ViewTests --> CoreView
    BackupTests["backup-view.test.tsx"] --> BackupView
    LaunchTests["menu-launch.test.ts"] --> MenuLaunch
    CliTests["cli.test.ts"] --> CLI
    ActionTests["menu-actions.test.ts"] --> MenuActions
    SessionTests["persistence-service.test.ts"] --> Sessions
    HttpTests["http-router.test.ts"] --> Router
    PtyTests["startup.integration.test.ts"] --> MenuApp
```

所有 UI 测试使用 fake `MenuActions`；不访问真实 Core/Gateway/Telegram。

---

## 14. 架构不变量

1. **单一 MenuApp**：menu 与 config 不再维护两套入口。
2. **单一 workspace**：Session、Gateway、Configure、Backup 使用同一个当前 workspace。
3. **真实入口唯一**：`Configure → Advanced → Gateway` 是真实 Gateway 配置入口。
4. **快捷入口有闸门**：顶级 Gateway 必须经过 WorkspaceGate。
5. **复用表单**：GatewayModal / GatewayInstanceForm / config wizard 不复制。
6. **无隐式启动**：安装/加载/保存不自动 start；启动需显式操作。
7. **状态来源唯一**：Gateway 进程状态来自 supervisor；平台检查来自 Client diagnostics。
8. **取消不写盘**：Back / Esc / Quit 取消不写 config、.env、history。
9. **CLI 一致**：`atom config` / `atom config gateway` 与 MenuApp 路由一致。
10. **非 TTY 安全失败**：无法启动 OpenTUI 时明确报错，不静默降级。

---

## 15. 已确认并实施

- [x] MenuApp 放在 `@atom-neo/config-tui`
- [x] `atom config` / `atom config gateway` 为唯一配置入口
- [x] 顶级 Gateway 强制 WorkspaceGate
- [x] `GET /api/sessions` 与受控 shutdown
- [x] WizardApp 作为路由级子页面复用
- [x] 审查修复：只读 config、Backup 密码、attached 保护、Session API admin、失败重试、长列表/长路径、PTY 覆盖
