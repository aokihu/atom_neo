# Atom Neo Code Review Graph — 2026-11-10

> 配套文件：
> - [code-review-2026-11-10.md](./code-review-2026-11-10.md)
> - [code-review-plan-2026-11-10.md](./code-review-plan-2026-11-10.md)
>
> 图中 `CR-*` 为问题 ID；`S0–S12` 为计划阶段。

---

## 0. 图例

| 符号 | 含义 |
|---|---|
| 实线 | 直接依赖/调用 |
| 虚线 | 重复、隐式依赖或待删除 |
| 红色节点 | P0 正确性问题 |
| 橙色节点 | 高重复/高耦合 |
| 绿色节点 | 目标统一模块 |
| 灰色节点 | 禁区/暂不修改 |

---

## 1. 包与目录依赖

```mermaid
graph TB
    subgraph Root["根入口"]
        MAIN["src/main.ts"]
        BOOT["src/bootstrap"]
        SERVICES["src/services"]
        DOCS["docs/server.ts"]
    end

    subgraph Packages["workspaces"]
        SHARED["@atom-neo/shared"]
        CORE["@atom-neo/core"]
        GATEWAY["@atom-neo/gateway"]
        TUI["@atom-neo/tui"]
        CONFIG_TUI["@atom-neo/config-tui"]
        TUI_KIT["@atom-neo/tui-kit (目标)"]
    end

    MAIN --> BOOT
    MAIN --> SERVICES
    MAIN --> CORE
    MAIN --> GATEWAY
    MAIN --> TUI
    MAIN --> CONFIG_TUI
    BOOT --> SHARED
    SERVICES --> SHARED
    CORE --> SHARED
    GATEWAY --> SHARED
    TUI --> SHARED
    TUI --> TUI_KIT
    CONFIG_TUI --> TUI_KIT
    TUI_KIT --> SHARED
    DOCS -->|"node:http + marked"| DOCS

    CONFIG_TUI -.->|"重复: config/providers/themes"| BOOT
    CONFIG_TUI -.->|"重复: Modal/theme"| TUI

    style CONFIG_TUI fill:#ffe0b2,stroke:#e65100
    style TUI fill:#ffe0b2,stroke:#e65100
    style TUI_KIT fill:#c8e6c9,stroke:#2e7d32
    style SHARED fill:#c8e6c9,stroke:#2e7d32
```

**结论**：
- 包边界总体正确；`config-tui` 与 `bootstrap`、`tui` 存在平行实现（虚线）。
- 目标新增 `@atom-neo/tui-kit`，让两个 UI 包只依赖它，不互相复制。

---

## 2. 运行时主流程

```mermaid
graph LR
    CLI["CLI / menu"] --> BOOT["bootstrap: config/env/logger"]
    BOOT --> SM["ServiceManager.startAll()"]
    SM --> MEM["MemoryService"]
    SM --> SKILL["SkillService"]
    SM --> NET["NetworkService"]
    SM --> COMPILER["AgentsCompilerService"]

    BOOT --> CORE["startCore()"]
    CORE --> BUS["PipelineEventBus"]
    CORE --> QUEUE["TaskQueue"]
    CORE --> ENGINE["TaskEngine"]
    CORE --> STORE["SessionStore"]
    CORE --> CTX["ContextService"]
    CORE --> TOOLS["ToolRegistry"]
    CORE --> WS["WS Handler / Broadcaster"]
    CORE --> HTTP["Bun.serve / node:http"]

    ENGINE --> PIPE["Pipeline: prediction → conversation → evaluator / compress / post"]
    PIPE --> ELEMENTS["Elements"]
    ELEMENTS --> CTX
    ELEMENTS --> TOOLS
    ELEMENTS --> STORE
    ELEMENTS --> LLM["LLM Provider"]

    WS --> TUI["TUI Client"]
    TUI --> STORE_UI["Zustand chat store"]

    style SM fill:#ffcdd2,stroke:#b71c1c
    style ENGINE fill:#ffe0b2,stroke:#e65100
    style PIPE fill:#ffe0b2,stroke:#e65100
    style LLM fill:#ffcdd2,stroke:#b71c1c
```

**风险点**：
- `ServiceManager.startAll()` 吞错（CR-COR-04），下游可能拿到 undefined。
- `TaskEngine` 事件重入与全局 pipeline map（CR-ARCH-02/08）。
- LLM 节点实际硬编码 DeepSeek（CR-PRO-01）。

---

## 3. 高影响文件与耦合热图

```mermaid
graph TB
    subgraph CoreHot["core 热点"]
        SERVER["server.ts 793"]
        STREAM["stream-llm.ts 1227"]
        CTX["context-service.ts 552"]
        PERSIST["persistence-service.ts 514"]
        ENGINE["task-engine.ts 281"]
        REGISTRY["pipeline/registry.ts"]
        TASKMAP["api/tasks.ts pipelineMap"]
    end

    subgraph ServicesHot["services 热点"]
        MEMORY["memory-service.ts 550"]
        CLIENTMGR["client-manager 272"]
        SERVICE_MGR["service-manager.ts"]
    end

    subgraph TuiHot["TUI 热点"]
        APP["components/App.tsx 212"]
        CHAT["stores/chat.ts 296"]
        USECHAT["hooks/useChat.ts 175"]
        WSCLIENT["client/ws-client.ts 260"]
        MODAL["components/modal/*"]
        CONFIG_MODAL["config-tui/modal/*"]
    end

    SERVER --> ENGINE
    SERVER --> STREAM
    SERVER --> CTX
    SERVER --> PERSIST
    ENGINE --> TASKMAP
    ENGINE --> REGISTRY
    STREAM --> CTX
    STREAM --> PERSIST
    STREAM --> TOOLS["tools/governance"]

    APP --> CHAT
    APP --> USECHAT
    APP --> MODAL
    USECHAT --> CHAT
    USECHAT --> WSCLIENT
    CONFIG_MODAL -.->|"重复"| MODAL

    style SERVER fill:#ffcdd2,stroke:#b71c1c
    style STREAM fill:#ffcdd2,stroke:#b71c1c
    style ENGINE fill:#ffe0b2,stroke:#e65100
    style TASKMAP fill:#ffcdd2,stroke:#b71c1c
    style REGISTRY fill:#ffcdd2,stroke:#b71c1c
    style CHAT fill:#ffe0b2,stroke:#e65100
    style CONFIG_MODAL fill:#ffe0b2,stroke:#e65100
```

**读法**：
- 红色节点是 P0/P1 必须优先处理的结构点。
- `stream-llm` 同时连接 Context、Persistence、Tools，是最高耦合节点。
- `server.ts` 同时连接 Engine、Stream、Context、Persistence，是组合根/路由/生命周期的混合体。

---

## 4. 重复 → 统一模块

```mermaid
graph LR
    subgraph Dup["重复源"]
        D1["Modal (tui)"]
        D2["Modal (config-tui)"]
        D3["Theme (tui)"]
        D4["Theme (config-tui)"]
        D5["Config schema (bootstrap)"]
        D6["Providers/Themes (wizard)"]
        D7["Gateway ClientConfig"]
        D8["env parser x3"]
        D9["atomic write x4"]
        D10["helpers: sleep/id/clamp..."]
        D11["Skill/Memory types x2-4"]
        D12["Event catalog x3"]
        D13["旧 JSX 页面 x33"]
    end

    subgraph Unified["目标统一模块"]
        KIT["@atom-neo/tui-kit"]
        CONFIG["shared/src/config"]
        FS["shared/src/utils/fs"]
        ENV["shared/src/utils/env-file"]
        UTILS["shared/src/utils"]
        TYPES["shared/src/types"]
        EVENTS["shared/src/constants/events"]
        DOCS["docs/server.ts"]
    end

    D1 --> KIT
    D2 --> KIT
    D3 --> KIT
    D4 --> KIT
    D5 --> CONFIG
    D6 --> CONFIG
    D7 --> CONFIG
    D8 --> ENV
    D9 --> FS
    D10 --> UTILS
    D11 --> TYPES
    D12 --> EVENTS
    D13 --> DOCS

    style KIT fill:#c8e6c9,stroke:#2e7d32
    style CONFIG fill:#c8e6c9,stroke:#2e7d32
    style FS fill:#c8e6c9,stroke:#2e7d32
    style ENV fill:#c8e6c9,stroke:#2e7d32
    style UTILS fill:#c8e6c9,stroke:#2e7d32
    style TYPES fill:#c8e6c9,stroke:#2e7d32
    style EVENTS fill:#c8e6c9,stroke:#2e7d32
    style DOCS fill:#c8e6c9,stroke:#2e7d32
```

**迁移顺序**：
1. `shared` 基础工具（S3）
2. `tui-kit`（S5）
3. `shared` 类型（S3）
4. 事件目录（S6）
5. 删除旧 JSX 文档站（S4）

---

## 5. 事件流与重复源

```mermaid
graph TB
    subgraph Source["事件定义源"]
        BUS["BusEvents<br/>constants/events.ts"]
        MAP["PipelineEventMap<br/>types/pipeline.ts"]
        PROTO["protocol.ts<br/>ClientEvent/ServerEvent"]
        DOC["protocol.md"]
    end

    subgraph Runtime["运行时"]
        CORE["Core emit"]
        WS["WsMessages<br/>Broadcaster"]
        TUI["TuiClient handlers"]
    end

    CORE --> BUS
    BUS --> WS
    WS --> TUI
    MAP -.->|"重复字面量"| BUS
    PROTO -.->|"重复字面量"| WS
    DOC -.->|"失真: replay/TUI submit"| WS

    style MAP fill:#ffe0b2,stroke:#e65100
    style PROTO fill:#ffe0b2,stroke:#e65100
    style DOC fill:#ffe0b2,stroke:#e65100
```

**目标（S6）**：

```text
EVENTS (single source)
  ├─ BusEvents (derived)
  ├─ WsMessages (derived)
  ├─ PipelineEventMap (derived)
  ├─ ServerEvent / ClientEvent (derived)
  └─ TuiClient message router (typed)
```

**已发现的契约 bug**：
- `conversation.chain` / `conversation.idle` 实际发送 `{ name, payload }`，类型声明是扁平 payload，只能 `as any`。
- WS `task.submit` 忽略 `payload.pipeline`（CR-COR-10）。
- `protocol.md` 的 `replay.event` 在代码中不存在（CR-DOC-08）。

---

## 6. Provider 流程：当前 vs 目标

### 当前

```mermaid
graph LR
    CFG["config.json providers"] --> RUNTIME["RuntimeService.getResolvedModel()"]
    RUNTIME -->|"provider/model/apiKey/baseUrl"| PIPE["Elements"]
    PIPE --> DS["createDeepSeek() ×5"]
    PIPE --> PROMPT["resolvePrompt() 默认 deepseek/zh"]
    DS --> API["实际 API"]
    PROMPT --> API

    style DS fill:#ffcdd2,stroke:#b71c1c
    style PROMPT fill:#ffcdd2,stroke:#b71c1c
    style RUNTIME fill:#ffe0b2,stroke:#e65100
```

**问题**：
- `provider` 字段无人消费。
- 5 处独立 `createDeepSeek`。
- `resolvePrompt` 多数调用不传 provider/model。
- `providerOptions` 只有 deepseek 形状。

### 目标

```mermaid
graph LR
    CFG["config.json + protocol"] --> RESOLVE["ModelResolver"]
    RESOLVE --> FACTORY["createLanguageModel()"]
    FACTORY --> DS["DeepSeek"]
    FACTORY --> OA["OpenAI"]
    FACTORY --> AN["Anthropic"]
    FACTORY --> OC["OpenAI-compatible"]
    FACTORY --> OPTS["ProviderOptionsStrategy"]
    FACTORY --> PROMPT["PromptRegistry(model)"]
    DS --> API["API"]
    OA --> API
    AN --> API
    OC --> API

    style FACTORY fill:#c8e6c9,stroke:#2e7d32
    style OPTS fill:#c8e6c9,stroke:#2e7d32
    style PROMPT fill:#c8e6c9,stroke:#2e7d32
```

**验收节点**：
- 所有 Element 只接收 `LanguageModel` 或 `ResolvedModel`，不再 import provider SDK。
- `agents-compiler` 与主对话共用工厂。
- 四种 provider 的 fake 测试 + 可选 live smoke。

---

## 7. Node / Bun 运行时策略

> S9 的完整关系图与阶段依赖见 [code-review-s9-graph-2026-11-11.md](./code-review-s9-graph-2026-11-11.md)；本节保留全局运行时策略摘要。

### 当前

```mermaid
graph TB
    subgraph BunOnly["Bun 专有 API"]
        BWRITE["Bun.write"]
        BSPAWN["Bun.spawn"]
        BGLOB["Bun.Glob"]
        BCRON["Bun.cron"]
        BSQL["bun:sqlite"]
        BSERVE["Bun.serve"]
        BWIDTH["Bun.stringWidth"]
        BENV["Bun.env"]
        BARGV["Bun.argv"]
    end

    BOOT["bootstrap"] --> BWRITE
    BOOT --> BWIDTH
    MAIN["main"] --> BARGV
    GW["gateway"] --> BSPAWN
    GW --> BENV
    CORE["core"] --> BSERVE
    CORE --> BSQL
    TOOLS["tools"] --> BGLOB
    TOOLS --> BCRON
    TOOLS --> BSPAWN

    style BSERVE fill:#ffcdd2,stroke:#b71c1c
    style BSQL fill:#ffcdd2,stroke:#b71c1c
```

### 目标

```mermaid
graph TB
    subgraph Standard["Node 标准 API（双运行时共用）"]
        FS["node:fs / fs.glob / writeFile"]
        CP["node:child_process"]
        SQL["node:sqlite"]
        ENV["process.env"]
        ARGV["process.argv"]
        WIDTH["string-width"]
        CRON["croner"]
    end

    subgraph HTTP["唯一适配层"]
        PORT["HttpServer / WebSocketPeer"]
        BUN["Bun.serve 实现"]
        NODE["node:http + ws 实现"]
    end

    BOOT["bootstrap"] --> FS
    BOOT --> WIDTH
    MAIN["main"] --> ARGV
    GW["gateway"] --> CP
    GW --> ENV
    CORE["core"] --> PORT
    CORE --> SQL
    TOOLS["tools"] --> FS
    TOOLS --> CP
    TOOLS --> CRON
    PORT --> BUN
    PORT --> NODE

    style PORT fill:#c8e6c9,stroke:#2e7d32
    style BUN fill:#e3f2fd,stroke:#1565c0
    style NODE fill:#e3f2fd,stroke:#1565c0
```

**决策门（S0）**：
- 若 `node:http + ws` 在 Bun 下可用 → 直接统一，删除 `Bun.serve`。
- 否则保留 `HttpServer` 双实现；这是唯一需要适配层的运行时能力。
- `node:sqlite` 本机已验证 Node 26 + Bun 1.4.2 + FTS5 均可用；最低版本在 S0 固化。

---

## 8. 重构阶段依赖图

```mermaid
graph LR
    S0["S0 基线/验证"] --> S1["S1 P0 修复"]
    S1 --> S2["S2 运行时标准化"]
    S1 --> S3["S3 共享配置/工具"]
    S1 --> S4["S4 文档服务"]
    S1 --> S5["S5 TUI kit"]
    S1 --> S6["S6 事件/提交"]

    S2 --> S9["S9 HTTP/WS + Node"]
    S3 --> S7["S7 Provider"]
    S3 --> S5
    S6 --> S8["S8 server 拆分"]
    S7 --> S8
    S8 --> S9
    S9 --> S10["S10 Node 构建/CI"]
    S3 --> S11["S11 DI 收口"]
    S10 --> S11
    S11 --> S12["S12 结构重构"]

    S4 -.->|"独立"| S3
    S5 -.->|"独立"| S6

    style S1 fill:#ffcdd2,stroke:#b71c1c
    style S9 fill:#ffcdd2,stroke:#b71c1c
    style S11 fill:#ffcdd2,stroke:#b71c1c
    style S12 fill:#ffcdd2,stroke:#b71c1c
```

**关键约束**：
- S6 先于 S8：事件契约稳定后再拆 server。
- S7 先于 S12：Provider 改动会触碰 `stream-llm`，先完成再做拆分。
- S9 先于 S10：Node 入口/HTTP 稳定后再做构建与 CI。
- S11 先于 S12：先收口构造与全局状态，再拆文件。

---

## 9. 问题 ID ↔ 文件 ↔ 阶段

| CR ID | 主要文件 | 阶段 |
|---|---|---|
| CR-COR-01 | `config-tui/wizard-logic.ts` | S1 |
| CR-COR-02 | `core/server.ts` | S1 |
| CR-COR-03 | `services/memory-service.ts` | S1 |
| CR-COR-04 | `services/service-manager.ts`, `base-service.ts` | S1 |
| CR-COR-05 | `shared/log/sinks/pipe.ts` | S1 |
| CR-COR-06 | `core/server.ts` | S1 |
| CR-COR-07 | `pipelines/shared/index.ts` | S1 |
| CR-COR-08 | `post-conversation/finalize.ts` | S1 |
| CR-COR-09 | `task-queue.ts`, `tool-record-store.ts` | S1 |
| CR-COR-10 | `ws/handler.ts`, `api/tasks.ts` | S1/S6 |
| CR-COR-11 | `main.ts`, `bootstrap/cli.ts` | S1 |
| CR-DUP-01 | `tui/modal`, `config-tui/modal` | S5 |
| CR-DUP-02 | `theme.ts`, `theme.tsx`, `types.ts` | S5 |
| CR-DUP-03 | `bootstrap/config.ts`, `wizard-logic.ts`, `gateway/config.ts` | S3 |
| CR-DUP-04 | `bootstrap/env.ts`, `backup.ts`, `wizard-logic.ts` | S3 |
| CR-DUP-05 | `backup.ts`, `runtime-file.ts`, `menu-history.ts`, `persistence-service.ts` | S3 |
| CR-DUP-06 | helpers 多处 | S3 |
| CR-DUP-07 | `shared/types`, `services`, `core/skills` | S3 |
| CR-DUP-08 | `constants/events.ts`, `types/pipeline.ts`, `protocol.ts` | S6 |
| CR-DUP-09 | 旧 JSX 文档站 | S4 |
| CR-DUP-10 | 5 个测试文件 | S1/S3 |
| CR-DUP-11 | `stream-llm.ts`, `tool-loop.ts` | S12 |
| CR-DUP-12 | 消息投影多处 | S12 |
| CR-NAM-01..11 | 见审查文件 | S3/S12 |
| CR-DOC-01..10 | `docs/` | S4 |
| CR-ARCH-01 | `pipeline/registry.ts` | S11 |
| CR-ARCH-02 | `api/tasks.ts`, `task-engine.ts` | S11 |
| CR-ARCH-03 | `shared/prompts/index.ts` | S11 |
| CR-ARCH-04 | `gateway/server.ts` | S1/S11 |
| CR-ARCH-05 | `tui/components/App.tsx` | S5 |
| CR-ARCH-06 | `service-manager.ts`, `server.ts` | S11 |
| CR-ARCH-07 | Elements 多处 | S12 |
| CR-ARCH-08 | `task-engine.ts` | S11 |
| CR-ARCH-09 | `gateway/client-manager` | S12 |
| CR-ARCH-10 | `tui/components/App.tsx` | S5/S12 |
| CR-ARCH-11 | `config-tui/WizardApp.tsx` | S12 |
| CR-ARCH-12 | `stream-llm.ts` | S12 |
| CR-ARCH-13 | `server.ts` | S8 |
| CR-ARCH-14 | 死代码清单 | S4/S11（只修文档/不删 Element） |
| CR-ARCH-15 | `ws/handler.ts` | S6 |
| CR-RUN-01..07 | 运行时文件 | S2/S9/S10 |
| CR-PRO-01..06 | Provider 文件 | S7 |
| CR-STR-01..11 | 结构拆分 | S12 |

---

## 10. 禁区子图

```mermaid
graph TB
    subgraph Forbidden["暂不修改（本次整改禁区）"]
        E1["load-system-prompt"]
        E2["fetch-agents-prompt"]
        E3["format-system-messages"]
        E4["format-user-messages"]
        E5["inject-skill-context"]
        FU["pipelines/follow-up"]
        RUN["PipelineRunner"]
        MGR["PipelineManager"]
        REC["PipelineRecorder/Player"]
        CP["CommandPalette"]
        COPIED["useCopied"]
    end

    CONV["conversation pipeline"] -.->|"注册但不在主链"| E1
    CONV -.-> E2
    CONV -.-> E3
    CONV -.-> E4
    CONV -.-> E5
    FU -.->|"无调用"| RUN
    CONV -.->|"未接线"| MGR
    CONV -.-> REC

    style Forbidden fill:#eeeeee,stroke:#616161
```

**说明**：
- 这些代码可以继续存在于仓库，但本次不重构、不删除、不接线。
- 文档中“已实现/可用”的错误声明要改；代码本身不动。
- 全局 registry 改造时，仍需保证这些 Element 的注册调用可编译/可运行。

---

## 11. 风险热力表

| 区域 | 变更风险 | 影响面 | 主要原因 |
|---|---|---|---|
| `stream-llm.ts` | 极高 | 全部对话 | 699 行 doProcess、工具治理、流式状态 |
| `server.ts` | 极高 | 启动/HTTP/WS/任务 | 组合根 + 路由 + 生命周期混合 |
| HTTP/WS 运行时 | 极高 | Core/Gateway/TUI | Bun.serve 与 Node http/ws 差异 |
| DI/全局状态 | 高 | 所有 pipeline 构造 | registry/pipelineMap/prompt singleton |
| MemoryService | 高 | 记忆/持久化 | DB 生命周期 + SQLite 迁移 |
| Provider 抽象 | 高 | 所有 LLM 调用 | 5 处 SDK + Prompt 语言 + options |
| TUI 状态 | 高 | 全部界面 | 全局 store、useChat 大 hook |
| 文档替换 | 中 | 文档 | 独立，但删除 6.5k 行 |
| 共享配置/工具 | 中 | bootstrap/config-tui/gateway | schema/env/atomic 多处调用 |
| P0 局部修复 | 低 | 单文件 | 可独立测试/回滚 |
