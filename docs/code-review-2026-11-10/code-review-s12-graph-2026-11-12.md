# Atom Neo Code Review Graph — S12 Giant Files / TUI Structure — 2026-11-12

> **Baseline**: `code-review/2026-11-10` @ `e3b51f5` (v1.23.0, S11 complete)
> **Status**: **S12 已拆分，待实施**。本图描述当前巨型文件依赖、目标模块边界、关键序列、阶段依赖、风险与回滚。
> **Scope**: S12 的 Core 结构拆分与 TUI 结构拆分
> **Related**:
> - [code-review-s12-2026-11-12.md](./code-review-s12-2026-11-12.md)
> - [code-review-s12-plan-2026-11-12.md](./code-review-s12-plan-2026-11-12.md)
> - [code-review-plan-2026-11-10.md](./code-review-plan-2026-11-10.md)

---

## 0. 图例

| 符号 | 含义 |
|---|---|
| 实线 | 直接依赖 / 调用 |
| 虚线 | 过渡包装、可选路径或待删除路径 |
| 红色节点 | 当前巨型文件 / 高回归面 |
| 橙色节点 | 需要拆分或重点验证 |
| 绿色节点 | 目标模块 / 已关闭项 |
| 蓝色节点 | 组合根 / 对外 facade |
| 灰色节点 | 范围外 / 禁区 |

---

## 1. S12 边界图

```mermaid
graph TB
    subgraph InScope["S12 范围内"]
        A["S12-A stream-llm<br/>16 tasks"]
        B["S12-B memory-service<br/>7 tasks"]
        C["S12-C context-service<br/>9 tasks"]
        D["S12-D persistence-service<br/>8 tasks"]
        E["S12-E helpers / supervisor / DUP<br/>18 tasks"]
        F["S12-F TUI chat<br/>10 tasks"]
        G["S12-G TUI panels / App / Wizard<br/>25 tasks"]
        H["S12-H acceptance<br/>4 tasks"]
    end

    subgraph OutScope["S12 范围外"]
        SERVER["server.ts<br/>CR-STR-02 closed by S8"]
        KIT["tui-kit extraction<br/>CR-STR-11 closed by S5"]
        ANY["full any cleanup"]
        FORBID["unimplemented Elements / Replay"]
        PROTO["protocol.ts / session context.ts<br/>residual >300 lines"]
    end

    A --> H
    B --> H
    C --> H
    D --> H
    E --> H
    F --> H
    G --> H

    SERVER -.->|"no change"| A
    KIT -.->|"only imports"| G
    ANY -.->|"deferred"| E
    FORBID -.->|"forbidden"| A
    PROTO -.->|"explicit exception"| H

    style A fill:#ffcdd2,stroke:#b71c1c
    style B fill:#ffe0b2,stroke:#e65100
    style C fill:#ffe0b2,stroke:#e65100
    style D fill:#ffe0b2,stroke:#e65100
    style E fill:#ffe0b2,stroke:#e65100
    style F fill:#ffe0b2,stroke:#e65100
    style G fill:#ffe0b2,stroke:#e65100
    style H fill:#c8e6c9,stroke:#2e7d32
    style SERVER fill:#c8e6c9,stroke:#2e7d32
    style KIT fill:#c8e6c9,stroke:#2e7d32
    style ANY fill:#e0e0e0,stroke:#616161
    style FORBID fill:#e0e0e0,stroke:#616161
    style PROTO fill:#e0e0e0,stroke:#616161
```

**结论**：

- S12 只做结构，不做功能；`server.ts` 与 `tui-kit` 只作为稳定依赖。
- 两个 TUI 阶段（F/G）与 Core 阶段（A-E）完全可并行，只有 H 需要全部完成。
- `protocol.ts` 与 `session/context.ts` 保持 >300 行是**显式例外**，不伪装成全仓库达标。

---

## 2. 当前巨型文件依赖图（Core）

```mermaid
graph TB
    subgraph Stream["stream-llm.ts (1240)"]
        SLLM["StreamLLMElement.doProcess"]
        SLOOP["while modelStep"]
        SSTEP["streamText + chunk"]
        STOOL["builtin/MCP tool wrappers"]
        SGOV["ToolCallLedger"]
        SCTX["Context snapshot / injection"]
        SREP["BusEvents + Transport"]
        SREC["ToolRecordStore"]
        SMAP["#toolResults side channel"]
        SFINAL["final result projection"]
    end

    subgraph Deps["依赖"]
        TL["tool-loop.ts"]
        GOV["tools/governance.ts"]
        CS["ContextService"]
        TRS["ToolRecordStore"]
        MP["model-provider.ts"]
        INTENT["builtin/intent.ts"]
        CONST["constants.ts"]
        CMP["context/compiler.ts"]
    end

    SLLM --> SLOOP
    SLOOP --> SSTEP
    SLOOP --> STOOL
    STOOL --> SGOV
    STOOL --> SMAP
    SLLM --> SCTX
    SLLM --> SREP
    STOOL --> SREC
    SLLM --> SFINAL
    SLLM --> TL
    STOOL --> GOV
    SCTX --> CS
    SCTX --> CMP
    SREC --> TRS
    SLLM --> MP
    SLLM --> INTENT
    SLLM --> CONST

    subgraph Memory["memory-service.ts (565)"]
        MS["MemoryService"]
        MDB["#initDb DDL/FTS"]
        MQ["search + ranking"]
        MG["traverse/link/edges"]
        ML["legacy migration"]
    end
    SQLITE["SqliteDatabase"]
    RANK["memory-ranking.ts"]
    MS --> MDB
    MS --> MQ
    MS --> MG
    MS --> ML
    MDB --> SQLITE
    MQ --> RANK
    MG --> RANK

    subgraph Context["context-service.ts (552)"]
        CSVC["ContextService"]
        CB["#buckets"]
        CSNAP["#snapshots + leases"]
        CLIFE["expire/sweep/dispose"]
        CPERS["export/restoreSessionState"]
    end
    COMP["compiler.ts"]
    CSVC --> CB
    CSVC --> CSNAP
    CSVC --> CLIFE
    CSVC --> CPERS
    CSVC --> COMP

    subgraph Persist["persistence-service.ts (515)"]
        PS["SessionPersistenceService"]
        PCK["generation write/publish"]
        PH["archive/search/read history"]
        PIO["durable/atomic IO"]
        PFMT["JSONL manifest"]
    end
    PTRS["ToolRecordStore"]
    PCS["ContextService"]
    PS --> PCK
    PS --> PH
    PS --> PIO
    PS --> PFMT
    PS --> PTRS
    PS --> PCS

    style SLLM fill:#ffcdd2,stroke:#b71c1c
    style SLOOP fill:#ffcdd2,stroke:#b71c1c
    style STOOL fill:#ffcdd2,stroke:#b71c1c
    style MS fill:#ffcdd2,stroke:#b71c1c
    style CSVC fill:#ffcdd2,stroke:#b71c1c
    style PS fill:#ffcdd2,stroke:#b71c1c
    style SMAP fill:#ffcdd2,stroke:#b71c1c
    style MDB fill:#ffe0b2,stroke:#e65100
    style CB fill:#ffe0b2,stroke:#e65100
    style CSNAP fill:#ffe0b2,stroke:#e65100
    style PCK fill:#ffe0b2,stroke:#e65100
```

**观察**：

- 四个 Core 巨型文件都把“生命周期 + 查询/执行 + 格式/IO + 上报”混在一起；彼此依赖是单向的，适合独立拆分。
- `stream-llm` 的 `#toolResults` 是跨函数侧信道，是最难搬移的状态。
- `persistence` 对 `ContextService` 是单向依赖；拆 checkpoint/history 不改变依赖方向。

---

## 3. 目标 Core 模块图

```mermaid
graph TB
    subgraph StreamTarget["stream-llm 目标"]
        SHELL["stream-llm.ts<br/>Element shell"]
        LOOP["stream-loop.ts"]
        STEP["stream-step.ts"]
        CTX["stream-context.ts"]
        REP["stream-reporting.ts"]
        FIN["stream-finalize.ts"]
        MI["stream-model-input.ts"]
        BATCH["tool-batch.ts"]
        TRT["tool-runtime.ts"]
        TRM["tool-runtime-mcp.ts"]
        TGR["tool-governance-runtime.ts"]
        TRS["tool-result-status.ts"]
        TL["tool-loop.ts<br/>stringify + projection"]
    end

    SHELL --> LOOP
    SHELL --> CTX
    SHELL --> FIN
    LOOP --> STEP
    LOOP --> BATCH
    LOOP --> REP
    LOOP --> CTX
    LOOP --> TRT
    BATCH --> TRT
    BATCH --> TRM
    TRT --> TGR
    TRM --> TGR
    TRT --> TRS
    STEP --> MI
    FIN --> MI
    BATCH --> TL
    TRT --> TL

    subgraph MemoryTarget["memory-service 目标"]
        MSVC["memory-service.ts<br/>facade"]
        MSTORE["memory-store.ts"]
        MQUERY["memory-query.ts"]
        MGRAPH["memory-graph.ts"]
        MTYPES["memory-types.ts"]
    end
    MSVC --> MSTORE
    MSVC --> MQUERY
    MSVC --> MGRAPH
    MQUERY --> MSTORE
    MQUERY --> MTYPES
    MGRAPH --> MSTORE
    MGRAPH --> MTYPES
    MSTORE --> MTYPES

    subgraph ContextTarget["context-service 目标"]
        CSVC["context-service.ts<br/>facade"]
        CBUCKET["bucket-store.ts"]
        CSNAP["snapshot-manager.ts"]
        CCODEC["context-codec.ts"]
        CTYPES["context-types.ts"]
    end
    CSVC --> CBUCKET
    CSVC --> CSNAP
    CSVC --> CCODEC
    CBUCKET --> CTYPES
    CSNAP --> CBUCKET
    CSNAP --> CTYPES
    CCODEC --> CTYPES

    subgraph PersistTarget["persistence-service 目标"]
        PSVC["persistence-service.ts<br/>facade"]
        PCK["checkpoint-store.ts"]
        PHIST["history-store.ts"]
        PFMT["session-format.ts"]
        PIO["durable-fs.ts"]
    end
    PSVC --> PCK
    PSVC --> PHIST
    PCK --> PFMT
    PCK --> PIO
    PHIST --> PFMT
    PHIST --> PIO

    subgraph HelperTarget["helpers 目标"]
        CFU["check-follow-up.ts"]
        CRULE["continuation-rules.ts"]
        CARB["continuation-arbitration.ts"]
        CMPF["compress-finalize.ts"]
        CMPC["compress-commit.ts"]
        CMPR["compress-resume.ts"]
        MPROJ["message-projection.ts"]
    end
    CFU --> CRULE
    CFU --> CARB
    CMPF --> CMPC
    CMPF --> CMPR
    CFU --> MPROJ
    CMPF --> MPROJ

    style SHELL fill:#c8e6c9,stroke:#2e7d32
    style LOOP fill:#c8e6c9,stroke:#2e7d32
    style STEP fill:#c8e6c9,stroke:#2e7d32
    style TRT fill:#c8e6c9,stroke:#2e7d32
    style MSVC fill:#c8e6c9,stroke:#2e7d32
    style CSVC fill:#c8e6c9,stroke:#2e7d32
    style PSVC fill:#c8e6c9,stroke:#2e7d32
    style CFU fill:#c8e6c9,stroke:#2e7d32
    style CMPF fill:#c8e6c9,stroke:#2e7d32
    style MPROJ fill:#c8e6c9,stroke:#2e7d32
```

**关键边**：

- `stream-llm` 只依赖 loop/context/finalize，不直接依赖 `streamText` 或工具执行。
- `tool-runtime` 是内置/MCP 的统一入口；`tool-runtime-mcp` 只做 MCP adapter。
- `memory-service` 是唯一公开 facade；`memory-store` 是唯一知道 SQLite 的模块。
- `context-service` 是唯一公开 facade；`bucket-store` / `snapshot-manager` 不互相持有完整服务。
- `persistence-service` 是唯一公开 facade；`checkpoint-store` / `history-store` 不互相调用。

---

## 4. 目标 TUI 模块图

```mermaid
graph TB
    subgraph ChatTarget["TUI chat 目标"]
        STORE["stores/chat.ts<br/>compose"]
        MSLICE["chat/message-slice.ts"]
        SSLICE["chat/stream-slice.ts"]
        TSLICE["chat/tool-slice.ts"]
        TEL["chat/telemetry-slice.ts"]
        HOOK["hooks/useChat.ts"]
        CONN["hooks/chat-connection.ts"]
        ERR["hooks/chat-errors.ts"]
        VIEW["components/ChatView.tsx"]
        VM["components/chat-view-model.ts"]
        WSC["client/ws-client.ts"]
        WSP["client/ws-client-protocol.ts"]
    end
    STORE --> MSLICE
    STORE --> SSLICE
    STORE --> TSLICE
    STORE --> TEL
    HOOK --> CONN
    HOOK --> ERR
    HOOK --> STORE
    CONN --> WSC
    CONN --> STORE
    WSC --> WSP
    VIEW --> STORE
    VIEW --> VM

    subgraph PanelTarget["TUI panels 目标"]
        APP["App.tsx"]
        APPM["app/AppModal.tsx"]
        SIDEBAR["Sidebar.tsx"]
        SIDESEC["sidebar/*Section.tsx"]
        RUNTIME["RuntimeSidebar.tsx"]
        RUNTIMESEC["runtime/*Section.tsx"]
        RUNTIMESTEP["runtime/runtime-steps.ts"]
        SETTINGS["SettingsModal.tsx"]
        SETMODEL["settings/settings-model.ts"]
        SETHOOK["settings/use-settings-config.ts"]
        INPUT["InputBar.tsx"]
        INESC["input/use-double-escape.ts"]
        INCMD["input/use-command-menu.ts"]
    end
    APP --> APPM
    APP --> SIDEBAR
    APP --> RUNTIME
    APP --> SETTINGS
    APP --> INPUT
    SIDEBAR --> SIDESEC
    RUNTIME --> RUNTIMESEC
    RUNTIME --> RUNTIMESTEP
    SETTINGS --> SETMODEL
    SETTINGS --> SETHOOK
    INPUT --> INESC
    INPUT --> INCMD

    subgraph WizardTarget["Wizard 目标"]
        WAPP["WizardApp.tsx"]
        WRED["wizard/wizard-reducer.ts"]
        WSTATE["wizard/wizard-state.ts"]
        WEDIT["wizard/wizard-edit.ts"]
        WCOMMIT["wizard/wizard-commit.ts"]
        WLOGIC["wizard-logic.ts<br/>barrel"]
    end
    WAPP --> WRED
    WRED --> WSTATE
    WRED --> WEDIT
    WRED --> WCOMMIT
    WLOGIC --> WSTATE
    WLOGIC --> WEDIT
    WLOGIC --> WCOMMIT

    style STORE fill:#c8e6c9,stroke:#2e7d32
    style HOOK fill:#c8e6c9,stroke:#2e7d32
    style CONN fill:#c8e6c9,stroke:#2e7d32
    style VIEW fill:#c8e6c9,stroke:#2e7d32
    style APP fill:#c8e6c9,stroke:#2e7d32
    style APPM fill:#c8e6c9,stroke:#2e7d32
    style SETMODEL fill:#c8e6c9,stroke:#2e7d32
    style WRED fill:#c8e6c9,stroke:#2e7d32
```

**边界**：

- store 的公开 API 不变；组件仍只 `useChatStore(selector)`。
- `chat-connection` 是唯一知道 `TuiClient` 事件名的地方；`useChat` 只做生命周期和 send/cancel。
- 面板 section 只读 store/theme；不再各自解析 ToolGroup。
- Wizard 的所有 view 跳转集中在 reducer；`WizardApp` 只 dispatch。

---

## 5. `stream-llm` 目标序列

```mermaid
sequenceDiagram
    autonumber
    participant EL as StreamLLMElement
    participant CTX as stream-context
    participant STEP as stream-step
    participant REP as stream-reporting
    participant BAT as tool-batch
    participant TRT as tool-runtime
    participant GOV as tool-governance-runtime
    participant FIN as stream-finalize
    participant BUS as PipelineEventBus

    EL->>EL: hydrate input / todo / trace
    EL->>CTX: initial snapshot / tool context
    loop modelStep <= maxSteps + 1
        EL->>CTX: refreshStepContext()
        CTX-->>EL: systemText + snapshot
        EL->>REP: model-step-start data
        EL->>STEP: runModelStep(system, messages, tools)
        STEP->>BUS: Transport.Reason / Delta
        STEP->>REP: usage / cache / static-prefix
        STEP-->>EL: StepOutcome { text, reasoning, calls, usage, finishReason, failed }
        EL->>CTX: commitSnapshot when healthy
        EL->>BAT: processToolBatch(stepCalls)
        BAT->>GOV: begin/finish per call
        BAT->>TRT: executeBuiltin / executeMCP
        TRT-->>BAT: ToolExecutionResult
        BAT->>BUS: ToolStarted / ToolFinished / ToolStepFinished
        BAT-->>EL: records + projections + intent/todo flags
        EL->>REP: stream-loop-ended reasons
    end
    EL->>FIN: projectResult(state)
    FIN-->>EL: responseText / tokenUsage / intents / flags
    EL->>BUS: Transport.ToolGroupComplete / Element done
```

**顺序不变式**：

- `beforeCall` 在每次 `streamText` 前；timeout 在 `beforeCall` 期间暂停。
- usage 在 chunk 消费后、tool batch 前；snapshot commit 只在 `!streamFailed && !timedOut && !aborted`。
- tool batch 在 `model-step-ended` 之后；`ToolStepFinished` 在 batch 结束后。
- `stream-loop-ended` 在 seal tool group 之前，`done` 在最终结果投影前。

---

## 6. Memory 数据流

```mermaid
graph LR
    CALLER["Tool / TUI / API"] --> SVC["MemoryService facade"]
    SVC --> STORE["memory-store"]
    SVC --> QUERY["memory-query"]
    SVC --> GRAPH["memory-graph"]

    QUERY --> STORE
    GRAPH --> STORE
    STORE --> DB["node:sqlite"]

    DB --> NODES["nodes"]
    DB --> EDGES["edges"]
    DB --> FTS["memory_fts (FTS5 trigram)"]
    DB --> TRG["nodes_fts_* triggers"]

    QUERY --> RANK["memory-ranking"]
    GRAPH --> RANK
    QUERY --> RET["retrieval_count / accessed_at"]
    GRAPH --> RET
    STORE --> MIG["legacy .txt migration"]
```

**不变量**：

- 表/索引/trigger 名称与 SQL 顺序不变。
- `search` 仍是 FTS5 长词 + `instr` 短词 + 过期过滤 + supersedes 过滤 + 0.4 覆盖率 + final score。
- `traverse` 仍是 BFS、最多 5 个结果、每层最多 3 个邻居、质量排序。
- `save` 的 content hash、UPSERT 冲突字段、supersedes edge 不变。

---

## 7. Context Snapshot 数据流

```mermaid
sequenceDiagram
    autonumber
    participant EL as StreamLLMElement
    participant SVC as ContextService
    participant BS as BucketStore
    participant SM as SnapshotManager
    participant CMP as compiler
    participant BUS as PipelineEventBus

    EL->>SVC: put(ContextPutRequest)
    SVC->>BS: put(bucket, entry)
    EL->>SVC: createSnapshot(request)
    SVC->>SM: create(request, buckets)
    SM->>CMP: compileContextSnapshot(fragments, budget)
    CMP-->>SM: snapshot + manifest + receipts + prefixHash
    SM->>BS: lease(bucketIds)
    SM-->>SVC: ContextSnapshot
    SVC-->>EL: snapshot { id, content }

    EL->>SVC: commitSnapshot(id)
    SVC->>SM: commit(id)
    SM->>BS: remove consumeOnCommit entries
    SM->>BS: release leases
    SVC->>BS: disposeExpired()

    BUS->>SVC: Context.SnapshotRelease(id)
    SVC->>SM: release(id)
    SM->>BS: release leases
    SVC->>BS: disposeExpired()
```

**不变量**：

- `createSnapshot` 仍先 `sweepExpired`，只选 active bucket，entry 过期过滤。
- lease 计数在 create 增加、commit/release 减少；`disposeExpired` 只删除 expired 且 lease=0 的 bucket。
- `commitSnapshot` 只删除 revision 匹配的 consumeOnCommit entry。
- snapshot TTL 默认 60 分钟；`sweepExpired` 负责 active→release、非 active→delete。

---

## 8. Persistence Checkpoint / Archive 流

```mermaid
graph TB
    subgraph Checkpoint["checkpoint(session, reason)"]
        A["read previous session.json"] --> B["revision + 1"]
        B --> C["inspect archives"]
        C --> D["session.exportState"]
        D --> E["context.exportSessionState"]
        E --> F["message-latest.jsonl"]
        F --> G["tool-records.jsonl"]
        G --> H["write generation .checkpoints/g-*"]
        H --> I["fsync dir + rename"]
        I --> J["publish current symlink"]
        J --> K["fsync + compat symlinks"]
        K --> L["cleanup old generations"]
    end

    subgraph Archive["archiveMessages(session, messages)"]
        M["validate seq"] --> N["find existing segment by from/to"]
        N --> O["next segment id message-000001"]
        O --> P["write atomic JSONL"]
        P --> Q["re-read verify count"]
        Q --> R["return receipt"]
    end

    subgraph Restore["restore(session)"]
        S["resolve current generation"] --> T["read session/context/messages/tool-records"]
        T --> U["revision consistency check"]
        U --> V["restore tool records + context"]
        V --> W["SessionContext.restore"]
        W --> X["active => checkpoint(restore)"]
    end
```

**不变量**：

- generation 名 `g-<12位 revision>-<uuid>`；`current` 是目录软链；顶层 `session.json`/`context.json`/`message-latest.jsonl`/`tool-records.jsonl` 是兼容软链。
- 提交点是 `current` 的 rename；旧 generation 清理失败不影响已提交 checkpoint。
- archive segment 写入后不可修改；verify 失败删除并抛错。
- `restore` 只在原 status 为 active 时写 `restore` checkpoint。

---

## 9. TUI 事件 / 状态流

```mermaid
sequenceDiagram
    autonumber
    participant CORE as Core WS
    participant WSC as TuiClient
    participant CONN as chat-connection
    participant STORE as chat store
    participant UI as ChatView / Sidebar / RuntimeSidebar
    participant USER as InputBar
    participant HTTP as POST /api/tasks

    CORE->>WSC: event.session.ready
    WSC->>CONN: onSnapshot + onTelemetry + onBusy
    CONN->>STORE: replace messages / rounds / todos
    UI->>STORE: selector subscription

    CORE->>WSC: event.transport.delta / reason
    WSC->>CONN: onDelta / onReason
    CONN->>STORE: handleDelta / handleReason
    STORE-->>UI: streaming assistant + counters

    CORE->>WSC: event.transport.tool.started/finished
    WSC->>CONN: onTool
    CONN->>STORE: handleToolEvent
    STORE-->>UI: tool-group entries

    CORE->>WSC: event.transport.tool.group.complete
    WSC->>CONN: onToolGroupComplete
    CONN->>STORE: collapse + summary

    USER->>HTTP: send(text)
    HTTP-->>USER: taskId
    USER->>WSC: await terminal event
    CORE->>WSC: event.task.completed
    WSC->>CONN: resolve pending + context tokens
    CONN->>STORE: setBusy false / contextTokens
```

**不变量**：

- `session.ready` 先于任何任务事件；snapshot 替换后 `activeAssistantId` 为空。
- `onDisconnect` 清空 telemetry 并插入 error 消息；不会自动重连。
- busy 由 `activeTaskIds.size > 0` 推导；`Task.Completed` 的 terminal 只 resolve 对应 rootTaskId。
- 输入/发送失败：`TaskCancelledError` → transient info 2s；API key invalid → `onClientError`；其他 → error message。

---

## 10. S12 子阶段依赖 DAG

```mermaid
graph LR
    subgraph CoreStream["Core 关键路径"]
        A["S12-A<br/>stream-llm<br/>45h"]
    end

    subgraph CoreData["Core 数据服务"]
        B["S12-B<br/>memory<br/>17.5h"]
        C["S12-C<br/>context<br/>21.5h"]
        D["S12-D<br/>persistence<br/>21.5h"]
    end

    subgraph CoreHelpers["Core 纯函数 / 残余"]
        E["S12-E<br/>helpers / supervisor / DUP<br/>38.5h"]
    end

    subgraph TUITrack["TUI 并行轨道"]
        F["S12-F<br/>chat store<br/>23h"]
        G["S12-G<br/>panels / App / Wizard<br/>59.5h"]
        F --> G
    end

    H["S12-H<br/>acceptance<br/>11h"]

    A --> H
    B --> H
    C --> H
    D --> H
    E --> H
    G --> H

    A -.->|"shared stringify/projection"| E
    A -.->|"tool projection"| F
    H -.->|"final numbers"| A

    style A fill:#ffcdd2,stroke:#b71c1c
    style B fill:#ffe0b2,stroke:#e65100
    style C fill:#ffe0b2,stroke:#e65100
    style D fill:#ffe0b2,stroke:#e65100
    style E fill:#ffe0b2,stroke:#e65100
    style F fill:#ffe0b2,stroke:#e65100
    style G fill:#ffe0b2,stroke:#e65100
    style H fill:#c8e6c9,stroke:#2e7d32
```

### 可并行

| 轨道 | 内容 | 前置 |
|---|---|---|
| Core-Stream | S12-A1..A16 | 无（最重要） |
| Core-Data | S12-B / C / D | 无（彼此不同目录） |
| Core-Helpers | S12-E | 无；E17 依赖 A3 |
| TUI-Chat | S12-F | 无 |
| TUI-Panels | S12-G | F 完成（G 使用 store 稳定 API；也可在 F1/F6 后开始） |
| Acceptance | S12-H | 全部 |

### 不建议的并行

- A9/A10/A14 同时改 `stream-llm.ts` 的 `doProcess` → 冲突；必须按 A2→A4..A15 顺序逐段切。
- C4/C5/C6 同时改 `context-service.ts` 的 bucket/snapshot 字段 → 冲突；先 store 后 manager。
- D4/D6 同时改 `persistence-service.ts` 的私有方法 → 冲突；先 checkpoint 后 history。
- G2/G3/G4 同时改 `Sidebar.tsx` → 冲突；先 section 再 composition。
- G19..G21 同时改 `wizard-logic.ts` → 冲突；按 state→edit→commit 顺序。

---

## 11. 关键路径与并行建议

```mermaid
graph LR
    A1["A1 snapshot"] --> A2["A2 model-input"]
    A2 --> A4["A4 tool status"]
    A4 --> A5["A5 governance"]
    A5 --> A6["A6 builtin runtime"]
    A6 --> A7["A7 MCP runtime"]
    A7 --> A8["A8 unify"]
    A8 --> A13["A13 tool batch"]
    A13 --> A14["A14 loop"]
    A14 --> A15["A15 finalize"]
    A15 --> A16["A16 slim"]
    A16 --> H2["H2 full matrix"]
    H2 --> H4["H4 final numbers"]
```

**关键路径（Core-Stream）**：A1 → A2 → A4 → A5 → A6 → A7 → A8 → A13 → A14 → A15 → A16 → H2 → H4 ≈ **51h**。

**最长并行轨道（TUI）**：F1 → F6 → G1 → G5/G9/G12/G15/G17/G24 → H2 ≈ **82.5h（含 H2/H4 约 85h）**。

**建议配置**：

| 人数 | 分配 | 预计（含 15% 缓冲） |
|---:|---|---|
| 1 | 全部串行 | 237.5h → **约 30 工程师日 / 7 周** |
| 2 | Core 全部 / TUI 全部 | max(151h, 86.5h) ≈ 151h → **约 22 工程师日 / 4–4.5 周** |
| 3 | Core-Stream / Core-Data+Helpers / TUI | 99h → **约 15 工程师日 / 3 周** |
| 4 | Core-Stream / Core-Data / Core-Helpers / TUI | 82.5h → **约 12 工程师日 / 2.5 周** |

> 原计划“8–12 天”对应约 64–96h，只能覆盖 A+B+C 的主路径，无法覆盖 D/E/F/G/H。建议按 **3–4 人、12–15 个工作日**排期；单人需 6–7 周。

---

## 12. 风险热区

```mermaid
graph TB
    subgraph High["高回归面"]
        LOOP["stream-loop / stream-step<br/>顺序 / 取消 / timeout"]
        TOOL["tool-runtime<br/>治理 / 执行 / 记录"]
        SNAP["snapshot-manager<br/>lease / commit / dispose"]
        CKPT["checkpoint-store<br/>generation / fsync / symlink"]
        STORE["chat store slices<br/>事件顺序 / streaming"]
    end

    subgraph Medium["中回归面"]
        MEM["memory-query / store<br/>FTS5 / 排序"]
        RULE["continuation-rules<br/>规则顺序"]
        COMP["compress-commit<br/>回滚 / resume"]
        PANEL["Sidebar / RuntimeSidebar<br/>布局 / scroll"]
        WIZ["wizard reducer<br/>view 迁移"]
    end

    subgraph Low["低回归面"]
        MODEL["stream-model-input"]
        STATUS["tool-result-status"]
        REP["stream-reporting"]
        CODEC["context-codec"]
        FMT["session-format"]
        TERM["process-termination"]
        PMSG["message-projection"]
    end

    LOOP --> TOOL
    LOOP --> SNAP
    TOOL --> STATUS
    SNAP --> CODEC
    CKPT --> FMT
    STORE --> PANEL
    RULE --> WIZ
    COMP --> CKPT

    style LOOP fill:#ffcdd2,stroke:#b71c1c
    style TOOL fill:#ffcdd2,stroke:#b71c1c
    style SNAP fill:#ffcdd2,stroke:#b71c1c
    style CKPT fill:#ffcdd2,stroke:#b71c1c
    style STORE fill:#ffcdd2,stroke:#b71c1c
    style MEM fill:#ffe0b2,stroke:#e65100
    style RULE fill:#ffe0b2,stroke:#e65100
    style COMP fill:#ffe0b2,stroke:#e65100
    style PANEL fill:#ffe0b2,stroke:#e65100
    style WIZ fill:#ffe0b2,stroke:#e65100
    style MODEL fill:#c8e6c9,stroke:#2e7d32
    style STATUS fill:#c8e6c9,stroke:#2e7d32
    style REP fill:#c8e6c9,stroke:#2e7d32
    style CODEC fill:#c8e6c9,stroke:#2e7d32
    style FMT fill:#c8e6c9,stroke:#2e7d32
    style TERM fill:#c8e6c9,stroke:#2e7d32
    style PMSG fill:#c8e6c9,stroke:#2e7d32
```

| 热区 | 原因 | 首要验证 |
|---|---|---|
| `stream-loop` / `stream-step` | 循环顺序、timeout、abort、usage | stream character + boundaries + cache |
| `tool-runtime` | 内置/MCP 治理与记录 | tool-loop + stream tests |
| `snapshot-manager` | lease/commit/dispose 时机 | context-service + stream-cache |
| `checkpoint-store` | fsync/rename/symlink 顺序 | persistence tests + 目录快照 |
| TUI chat store | delta/tool/busy 事件顺序 | chat store tests + App smoke |
| memory query/store | FTS5 与排序 | memory tests + schema dump |
| continuation rules | 规则优先级 | check-follow-up tests |
| compress commit | checkpoint 回滚/resume | compress tests |
| wizard reducer | view 顺序/quit guard | WizardApp tests |

---

## 13. 回滚关系

```mermaid
graph LR
    H["S12-H 验收"] --> G["S12-G TUI panels / Wizard"]
    H --> F["S12-F TUI chat"]
    H --> E["S12-E helpers / supervisor"]
    H --> D["S12-D persistence"]
    H --> C["S12-C context"]
    H --> B["S12-B memory"]
    H --> A["S12-A stream-llm"]

    A -.->|"revert"| RA["恢复单文件 stream-llm<br/>旧 re-export 已存在"]
    B -.->|"revert"| RB["恢复 memory-service 内联<br/>facade re-export 保持"]
    C -.->|"revert"| RC["恢复 context-service 内联<br/>公共 API 不变"]
    D -.->|"revert"| RD["恢复 persistence-service 内联<br/>目录格式不变"]
    E -.->|"revert"| RE["恢复 check-follow-up / compress-finalize<br/>supervisor 内联"]
    F -.->|"revert"| RF["恢复 chat.ts / useChat.ts 单文件"]
    G -.->|"revert"| RG["恢复面板/App/Wizard 单文件"]
    H -.->|"revert"| RH["只回退测试/文档/guard"]

    style H fill:#c8e6c9,stroke:#2e7d32
    style G fill:#ffe0b2,stroke:#e65100
    style F fill:#ffe0b2,stroke:#e65100
    style E fill:#ffe0b2,stroke:#e65100
    style D fill:#ffe0b2,stroke:#e65100
    style C fill:#ffe0b2,stroke:#e65100
    style B fill:#ffe0b2,stroke:#e65100
    style A fill:#ffcdd2,stroke:#b71c1c
```

**回滚原则**：

- 每个任务一个 commit；回滚从后往前，不依赖后续任务。
- 所有“提取模块”任务先保留 facade re-export；删除旧路径单独一个 commit（A16/B7/C9/D8/E18/F10/G25）。
- 纯搬移任务回滚只恢复 import/调用点；新文件可保留（不参与编译）。
- `stream-llm` 回滚必须同时回退 A14/A15 的 loop/finalize 调用；A16 之后回滚需先恢复旧 re-export。
- B/C/D 回滚只影响内部结构；公共 API、DB/文件格式不变。
- F/G 回滚不影响 Core；TUI 组件测试与手工 smoke 是主要防线。
- H 只回退测试/文档/guard，不回退生产代码。

---

## 14. 测试覆盖图

```mermaid
graph TB
    subgraph Snapshots["行为快照 / 特征测试"]
        S1["stream character<br/>events / requests / result"]
        S2["memory schema + search order"]
        S3["context persisted JSON + snapshot state"]
        S4["persistence directory + JSONL manifest"]
        S5["TUI store state transitions"]
        S6["wizard view transition table"]
    end

    subgraph Unit["单元"]
        U1["stream-model-input / step / reporting"]
        U2["tool-runtime / governance / batch"]
        U3["memory query/graph/store"]
        U4["bucket store / snapshot manager / codec"]
        U5["checkpoint store / history store / format"]
        U6["continuation rules / arbitration"]
        U7["compress commit / resume"]
        U8["chat slices / connection / view model"]
        U9["panel sections / settings model / input hooks"]
    end

    subgraph Integration["集成"]
        I1["conversation pipeline + tool loop"]
        I2["context + stream snapshot commit"]
        I3["persistence restore/history"]
        I4["memory FTS5 + migration"]
        I5["TUI App render / InputBar keyboard"]
        I6["WizardApp reducer + render"]
    end

    subgraph Acceptance["验收"]
        A1["typecheck 6/6 + typecheck:node"]
        A2["bun test source + full"]
        A3["build + Node smoke + package"]
        A4["docs:check + docs:typecheck"]
        A5["line/function guard"]
    end

    S1 --> U1
    S1 --> U2
    S2 --> U3
    S3 --> U4
    S4 --> U5
    S5 --> U8
    S6 --> U9
    U1 --> I1
    U2 --> I1
    U3 --> I4
    U4 --> I2
    U5 --> I3
    U8 --> I5
    U9 --> I6
    I1 --> A2
    I2 --> A2
    I3 --> A2
    I4 --> A2
    I5 --> A2
    I6 --> A2
    A1 --> A2
    A2 --> A3
    A2 --> A4
    A2 --> A5
```

**门禁**：

- 每个结构任务至少更新一个目标测试；纯搬移任务用“旧测试不改也通过 + 新模块单测”。
- A1/B1/C1/D1/F1/G18 是阶段入口：没有行为快照不开始搬移。
- H1 的 guard 是出口条件：目标文件超 300 行或主函数超 100 行即失败。
- Node smoke 只验证构建/启动/package，不要求跑全部 `bun:test`。

---

## 15. 禁止的依赖边

```mermaid
graph TB
    subgraph Forbidden["禁止"]
        F1["stream-llm → 直接 streamText"]
        F2["stream-loop → tool-runtime 内部实现"]
        F3["memory-query → SQLite 细节"]
        F4["snapshot-manager → ContextService 反向"]
        F5["history-store → checkpoint-store"]
        F6["TUI component → TuiClient 事件"]
        F7["WizardApp → wizard-logic 内部状态"]
        F8["任何新模块 → 模块级可变 Map"]
    end

    subgraph Allowed["允许"]
        A1["stream-llm → stream-loop / context / finalize"]
        A2["tool-runtime → governance / status / tool-loop"]
        A3["memory-service → store / query / graph"]
        A4["context-service → bucket-store / snapshot-manager"]
        A5["persistence-service → checkpoint-store / history-store"]
        A6["useChat → chat-connection → store"]
        A7["WizardApp → reducer → wizard state/edit/commit"]
        A8["TUI components → tui-kit / chat store"]
    end

    style Forbidden fill:#ffcdd2,stroke:#b71c1c
    style Allowed fill:#c8e6c9,stroke:#2e7d32
```

**说明**：

- `stream-llm` 是编排层，不再直接知道 AI SDK 的 `streamText`。
- `stream-loop` 只通过 `tool-batch`/`tool-runtime` 的公开函数执行工具，不读 `#toolResults`。
- `memory-query` 不写 SQL DDL；所有 schema 在 `memory-store`。
- `snapshot-manager` 不直接改 bucket entry；通过 `BucketStore` 窄方法。
- `history-store` 不解析 `current` 指针；checkpoint 生命周期只属于 `checkpoint-store`。
- TUI 组件不订阅 `TuiClient`；只有 `chat-connection` 接收事件。
- Wizard 组件不直接修改 wizard 字段；只 dispatch action。
- 新增模块级可变状态视为失败（S11 DoD 延续）。
