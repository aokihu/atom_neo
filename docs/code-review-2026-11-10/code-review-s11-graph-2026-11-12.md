# Atom Neo Code Review Graph — S11 Global State / DI — 2026-11-12

> **Baseline**: `code-review/2026-11-10` @ `ef7ff15` (v1.22.12)
> **Scope**: S11 的当前全局状态、目标注入关系、关键序列、阶段依赖、风险与回滚
> **Related**:
> - [code-review-s11-2026-11-12.md](./code-review-s11-2026-11-12.md)
> - [code-review-s11-plan-2026-11-12.md](./code-review-s11-plan-2026-11-12.md)
> - [code-review-plan-2026-11-10.md](./code-review-plan-2026-11-10.md)

---

## 0. 图例

| 符号 | 含义 |
|---|---|
| 实线 | 直接依赖 / 调用 |
| 虚线 | 过渡包装、可选路径或待删除路径 |
| 红色节点 | 当前全局状态 / 高风险 |
| 橙色节点 | 需要改造或重点验证 |
| 绿色节点 | 目标实例化模块 |
| 蓝色节点 | 注入 / 组合根 |
| 灰色节点 | 禁区 / 范围外 |

---

## 1. S11 边界图

```mermaid
graph TB
    subgraph InScope["S11 范围内"]
        A["S11-A 类型化 Services + PromptRegistry"]
        B["S11-B ElementRegistry"]
        C["S11-C PipelineInstanceStore"]
        D["S11-D TaskEngine 单循环"]
        E["S11-E ProcessSupervisor"]
        F["S11-F Theme 防回归"]
        G["S11-G Element 窄接口"]
        H["S11-H 双实例验收 / 清理"]
    end

    subgraph OutScope["S11 范围外"]
        S12["S12 巨型文件 / TUI 布局"]
        ANY["全量 any 清理"]
        RUNNER["PipelineRunner / Replay"]
        CONTAINER["DI 容器 / 反射注入"]
    end

    A --> H
    B --> H
    C --> H
    D --> H
    E --> H
    F --> H
    G --> H
    ANY -.-> S12
    RUNNER -.->|"禁区，不改"| A
    CONTAINER -.->|"不引入"| A
    H -.->|"handoff"| S12

    style A fill:#c8e6c9,stroke:#2e7d32
    style B fill:#c8e6c9,stroke:#2e7d32
    style C fill:#c8e6c9,stroke:#2e7d32
    style D fill:#ffe0b2,stroke:#e65100
    style E fill:#ffe0b2,stroke:#e65100
    style F fill:#c8e6c9,stroke:#2e7d32
    style G fill:#ffe0b2,stroke:#e65100
    style H fill:#c8e6c9,stroke:#2e7d32
    style S12 fill:#e0e0e0,stroke:#616161
    style ANY fill:#e0e0e0,stroke:#616161
    style RUNNER fill:#e0e0e0,stroke:#616161
    style CONTAINER fill:#e0e0e0,stroke:#616161
```

**结论**:

- S11 只改“谁创建、谁持有、谁注入”，不改 Element 算法、不改协议。
- 全量 `any` 与巨型文件拆分享 S12，不在 S11 做。
- CR-ARCH-04/05 已关闭，F 只是防回归。

---

## 2. 当前全局状态图

```mermaid
graph TB
    subgraph Entry["入口 / 组合根"]
        MAIN["src/main.ts"]
        SM["ServiceManager（字符串定位）"]
        BS["bootstrap.ts"]
        SRV["server.ts startCore"]
    end

    subgraph Globals["模块级全局状态"]
        REG["registry: Map<br/>pipeline/registry.ts"]
        PROMPT["_instance: PromptRegistry<br/>prompts/index.ts"]
        PMAP["pipelineMap: Map<br/>api/tasks.ts"]
        COMPILER["sm.get('agents-compiler')"]
        MEMORY["sm.get('memory')"]
        NETWORK["sm.get('network')"]
    end

    subgraph Core["Core 运行时"]
        BUILDERS["register*Elements()"]
        BUILDER["PipelineBuilder"]
        ENGINE["TaskEngine"]
        LOOP["#onTaskEnqueued 递归"]
        FLOW["current.abortSignal = signal<br/>变异 FlowState"]
        LIFECYCLE["task-lifecycle.ts"]
    end

    subgraph Gateway["Gateway"]
        CM["ClientManager"]
        EXIT["onExit 回调"]
        TIMER["setTimeout 重启"]
        SERIAL["#serialize Promise"]
        HEALTH["healthCheck 只打日志"]
    end

    MAIN --> SM
    MAIN --> SRV
    SRV --> BS
    BS --> COMPILER
    BS --> MEMORY
    BS --> NETWORK
    BS --> BUILDERS
    BUILDERS --> REG
    BUILDER --> REG
    ENGINE --> PMAP
    ENGINE --> LOOP
    ENGINE --> FLOW
    ENGINE --> LIFECYCLE
    BS --> PROMPT
    CM --> EXIT
    CM --> TIMER
    CM --> SERIAL
    CM --> HEALTH
    EXIT -.-> TIMER
    HEALTH -.->|"不触发重启"| TIMER

    style REG fill:#ffcdd2,stroke:#b71c1c
    style PROMPT fill:#ffcdd2,stroke:#b71c1c
    style PMAP fill:#ffcdd2,stroke:#b71c1c
    style LOOP fill:#ffcdd2,stroke:#b71c1c
    style FLOW fill:#ffcdd2,stroke:#b71c1c
    style EXIT fill:#ffe0b2,stroke:#e65100
    style TIMER fill:#ffe0b2,stroke:#e65100
    style SERIAL fill:#ffe0b2,stroke:#e65100
    style HEALTH fill:#ffe0b2,stroke:#e65100
    style SM fill:#ffe0b2,stroke:#e65100
```

**观察**:

- 三张全局表（registry、prompt singleton、pipelineMap）互不相关，但都阻止双实例。
- `TaskEngine` 依赖 `api/tasks.ts`，形成 core 内部的分层倒置。
- `ClientManager` 的 exit/timer/health 没有共同状态源；健康检查是“只读告警”。
- 模块级全局不经过 logger/生命周期，测试无法隔离。

---

## 3. 目标 DI 图

```mermaid
graph TB
    subgraph Entry["入口 / 组合根"]
        MAIN["main.ts"]
        LOGGER["Logger"]
        SM["ServiceManager<br/>仅 startAll/stopAll"]
        SERVICES["CoreServices<br/>memory / network / skill? / compiler?"]
        HTTP["HttpServer"]
    end

    subgraph CoreCompose["startCore 组合根"]
        BOOT["createCoreBootstrap"]
        PROMPT["PromptRegistry<br/>createPromptRegistry()"]
        RESOLVER["PromptResolver"]
        ELEM["ElementRegistry<br/>createElementRegistry()"]
        FACTORY["createPipelineFactory"]
        STORE["PipelineInstanceStore"]
        ENGINE["TaskEngine"]
        QUEUE["TaskQueue"]
        BUS["PipelineEventBus"]
    end

    subgraph ElementLayer["Pipeline / Element"]
        PIPE["Pipeline"]
        EL["Element 实例"]
        SESSION["PipelineSession"]
    end

    subgraph Gateway["Gateway"]
        GW["startGateway"]
        CM["ClientManager"]
        SUP["ProcessSupervisor"]
        POLICY["RestartPolicy"]
        PROBE["HealthProbe"]
    end

    MAIN --> LOGGER
    MAIN --> SM
    MAIN --> SERVICES
    MAIN --> HTTP
    MAIN --> BOOT
    SM -.->|"持有同一批服务实例"| SERVICES
    BOOT --> SERVICES
    BOOT --> PROMPT
    PROMPT --> RESOLVER
    BOOT --> ELEM
    BOOT --> FACTORY
    FACTORY --> ELEM
    FACTORY --> RESOLVER
    FACTORY --> PIPE
    PIPE --> EL
    EL --> SESSION
    BOOT --> STORE
    BOOT --> QUEUE
    BOOT --> BUS
    BOOT --> ENGINE
    ENGINE --> QUEUE
    ENGINE --> BUS
    ENGINE --> STORE
    ENGINE --> FACTORY
    GW --> CM
    CM --> SUP
    SUP --> POLICY
    SUP --> PROBE

    style SERVICES fill:#c8e6c9,stroke:#2e7d32
    style PROMPT fill:#c8e6c9,stroke:#2e7d32
    style RESOLVER fill:#c8e6c9,stroke:#2e7d32
    style ELEM fill:#c8e6c9,stroke:#2e7d32
    style STORE fill:#c8e6c9,stroke:#2e7d32
    style ENGINE fill:#c8e6c9,stroke:#2e7d32
    style SUP fill:#c8e6c9,stroke:#2e7d32
    style POLICY fill:#c8e6c9,stroke:#2e7d32
    style PROBE fill:#c8e6c9,stroke:#2e7d32
    style MAIN fill:#e3f2fd,stroke:#1565c0
    style BOOT fill:#e3f2fd,stroke:#1565c0
    style GW fill:#e3f2fd,stroke:#1565c0
```

**关键边**:

- `main.ts` 是唯一同时知道具体服务类、logger、HttpServer、sandbox 的地方。
- `CoreServices` 是普通对象，不是容器；`ServiceManager` 不再进入 Core。
- `ElementRegistry` 与 `PromptRegistry` 由 `createCoreBootstrap` 创建，并沿 `createPipelineFactory → pipeline → Element` 注入。
- `PipelineInstanceStore` 只被 `TaskEngine` 读写；HTTP 层不再持有 pipeline。
- `ProcessSupervisor` 是 Gateway 内部唯一状态源；`ClientManager` 只做 facade。

---

## 4. ElementRegistry / Pipeline 构造序列

```mermaid
sequenceDiagram
    autonumber
    participant MAIN as main.ts
    participant BOOT as createCoreBootstrap
    participant REG as ElementRegistry
    participant REGFN as register*Elements()
    participant FACT as createPipelineFactory
    participant BUILD as TaskEngine
    participant STORE as PipelineInstanceStore
    participant PIPE as Pipeline
    participant EL as Element

    MAIN->>BOOT: options { services, logger, sandbox }
    BOOT->>REG: createElementRegistry()
    BOOT->>REGFN: registerConversationElements(registry)
    REGFN->>REG: register("collect-prompts", Ctor)
    REGFN->>REG: register("stream-llm", Ctor)
    Note over REG: 同一实例注册 5 条 pipeline 的元素
    BOOT->>FACT: createPipelineFactory({ elementRegistry: reg, ... })
    BOOT->>BUILD: new TaskEngine({ bus, queue, pipelineStore, pipelineBuilders })
    BUILD->>STORE: get(taskId)
    alt cache miss
        BUILD->>FACT: builders[pipeline](task)
        FACT->>REG: resolve(elementName)
        REG-->>FACT: ElementConstructor
        FACT->>PIPE: build()
        PIPE->>EL: new Ctor({ deps, bus, name, kind })
        FACT-->>BUILD: Pipeline
        BUILD->>STORE: set(taskId, pipeline)
    end
```

**不变式**:

- 注册顺序仍是 conversation → prediction → follow-up → follow-up-evaluator → context-compress → post-conversation → shared。
- Element 的构造参数（deps、bus、name、kind）不变；只多一个 registry 解析来源。
- 重复注册仍抛错；错误文案不变。

---

## 5. Prompt 解析序列

```mermaid
sequenceDiagram
    autonumber
    participant MAIN as main.ts
    participant BOOT as createCoreBootstrap
    participant PREG as PromptRegistry
    participant RES as PromptResolver
    participant FACT as createPipelineFactory
    participant EL as Element
    participant REG as PromptRegistry.resolve

    MAIN->>BOOT: startCore({ services, ... })
    BOOT->>PREG: createPromptRegistry()
    PREG->>PREG: registerLangBases(zh/en)
    PREG->>PREG: registerModelRefinements(...)
    BOOT->>RES: createPromptResolver(registry)
    BOOT->>FACT: { promptResolver: res }
    FACT->>EL: new Element({ promptResolver: res, providerModel })
    EL->>RES: resolvePrompt(key, "provider/model")
    RES->>REG: registry.resolve(key, provider, model)
    REG-->>RES: base + refinements (cached)
    RES-->>EL: string
```

**不变式**:

- `LANGUAGE_MAP` 与 `MODEL_REFINEMENT_MAP` 不变。
- 缓存 key `key:provider:model` 与当前完全一致。
- 默认 provider/model 仍是 `openai/gpt-4o`（当未传 `providerModel`）。
- 两个 registry 可注册不同 refinement，互不影响；生产路径只创建一个。

---

## 6. TaskEngine 单循环序列

```mermaid
sequenceDiagram
    autonumber
    participant SUB as TaskSubmissionService
    participant BUS as PipelineEventBus
    participant ENG as TaskEngine
    participant WAKE as Wakeup
    participant Q as TaskQueue
    participant STORE as PipelineInstanceStore
    participant PIPE as Pipeline
    participant LIFECYCLE as task-lifecycle

    SUB->>Q: enqueue(task)
    SUB->>BUS: emit Task.Enqueued
    BUS->>ENG: onEnqueued()
    ENG->>WAKE: notify()
    loop while running
        ENG->>Q: dequeue()
        alt empty
            ENG->>WAKE: await wait()
        else task
            ENG->>STORE: get(task.id)
            alt no pipeline
                ENG->>PIPE: builder(task).build(bus)
                ENG->>STORE: set(task.id, pipeline)
            end
            ENG->>BUS: emit Task.Activated
            loop elements
                ENG->>PIPE: process({ ...state, abortSignal })
                PIPE-->>ENG: next state
            end
            alt success
                ENG->>Q: markDone(task.id)
                ENG->>BUS: emit Task.Completed
                ENG->>BUS: emit Pipeline.Result
            else error / cancelled
                ENG->>Q: markDone(task.id)
                ENG->>BUS: emit Task.Failed
            end
            ENG->>STORE: delete(task.id)
        end
    end
    LIFECYCLE->>BUS: Task.Completed / Task.Failed
```

**关键点**:

- 唤醒只发生在 `Task.Enqueued`；事件处理器不执行任务。
- `dequeue` 先于 `wait`，避免“入队通知早于等待”丢失。
- `start()` 幂等；`stop()` 只置位并唤醒，不 abort 当前 task。
- `drain()` 仍轮询 `queue.size`，超时返回 false。
- FlowState 每次展开为新对象；Element 不修改上游对象。

---

## 7. PipelineInstanceStore 生命周期

```mermaid
sequenceDiagram
    autonumber
    participant ENG as TaskEngine
    participant STORE as PipelineInstanceStore
    participant Q as TaskQueue
    participant BUS as PipelineEventBus

    Note over STORE: task 开始前
    ENG->>STORE: get(taskId) → undefined
    ENG->>ENG: builder(task) 构造 pipeline
    ENG->>STORE: set(taskId, pipeline)

    alt completed
        ENG->>Q: markDone(taskId)
        ENG->>BUS: Task.Completed
        ENG->>STORE: delete(taskId)
    else failed
        ENG->>Q: markDone(taskId)
        ENG->>BUS: Task.Failed
        ENG->>STORE: delete(taskId)
    else cancelled while queued
        ENG->>Q: storeResult(cancelled)
        ENG->>STORE: delete(taskId)
        ENG->>BUS: Task.Failed
    else cancelled while processing
        ENG->>ENG: abortController.abort(reason)
        ENG->>BUS: Task.Failed
        ENG->>STORE: delete(taskId)
    end

    Note over STORE: drain / stop 后 size === 0
```

**不变式**:

- `store` 不持久化；进程重启后为空。
- 同一 taskId 的 pipeline 只构造一次；构造失败不写入。
- 取消 queued task 也要 `delete`（当前 `removePipeline` 行为）。
- `store.size` 可用于关闭验收；不做 TTL。

---

## 8. ClientManager / ProcessSupervisor 状态机

```mermaid
stateDiagram-v2
    [*] --> idle
    idle --> starting: start()
    starting --> running: readiness ok
    starting --> failed: spawn error / readiness timeout
    running --> running: health ok
    running --> failed: exit(unexpected) / health_failed
    running --> stopping: stop()
    stopping --> idle: process exited
    failed --> starting: restart timer (desired)
    failed --> idle: stop() / give_up
    stopping --> failed: kill timeout
    failed --> [*]: stopAll()

    note right of idle
      no process, no timer
      desired=false
    end note

    note right of starting
      spawn done, readiness polling
      100ms interval, 10s deadline
    end note

    note right of running
      process alive, health probe every 30s
      uptime >= 60s resets attempts
    end note

    note right of failed
      RestartPolicy.next()
      max 5, backoff 1s*2^n (cap 30s)
    end note
```

**并发约束**:

- 同一 client 的所有 `start/stop/restart/spawn/stopProcess` 通过一个操作队列串行。
- `stopAll` 先置 `stopping`、清 desired、清 timer，再并行 stop 所有 client。
- `exit` 回调只通知 supervisor；是否重启由状态机 + desired 决定，不在回调里直接 setTimeout。
- 健康失败与 exit 走同一 `failed` 入口；健康成功在 uptime ≥ 60s 时重置 attempts。
- `stop()` 后不得再因旧 timer 或旧 exit 回调进入 `starting`。

---

## 9. S11 子阶段依赖 DAG

```mermaid
graph LR
    subgraph CoreTrack["Core 主路径"]
        A["S11-A<br/>Services + Prompt"] --> B["S11-B<br/>ElementRegistry"]
        B --> C["S11-C<br/>PipelineInstanceStore"]
        C --> D["S11-D<br/>TaskEngine"]
        D --> G["S11-G<br/>Element 窄接口"]
        G --> H["S11-H<br/>双实例验收"]
    end

    subgraph GatewayTrack["Gateway 并行路径"]
        E["S11-E<br/>ProcessSupervisor"]
    end

    subgraph Independent["独立小项"]
        F["S11-F<br/>Theme guard"]
    end

    A -.->|"可并行准备"| E
    E --> H
    F --> H
    A --> G
    B -.->|"registry 类型"| G

    style A fill:#ffe0b2,stroke:#e65100
    style B fill:#ffe0b2,stroke:#e65100
    style C fill:#c8e6c9,stroke:#2e7d32
    style D fill:#ffe0b2,stroke:#e65100
    style E fill:#ffe0b2,stroke:#e65100
    style F fill:#c8e6c9,stroke:#2e7d32
    style G fill:#ffe0b2,stroke:#e65100
    style H fill:#c8e6c9,stroke:#2e7d32
```

### 可并行

| 轨道 | 内容 | 前置 |
|---|---|---|
| Core-A | S11-A（Services + Prompt） | 无（但会改 bootstrap/pipeline-factory） |
| Core-B | S11-B（Registry） | A5 之后（同改 bootstrap） |
| Gateway | S11-E（ProcessSupervisor） | 无（独立包） |
| Theme | S11-F | 无 |
| 验收 | S11-H1/H2/H4/H5 | 对应实现完成 |

### 关键路径

```text
A5 → B7 → C2 → D2 → D6 → G2..G6 → H1 → H6 → H7
```

单开发者关键路径约 **89 小时**（不含 Gateway E 的 20 小时；E 可并行）。加上 15% 缓冲约 **102 小时 ≈ 13 个工程师日**。

### 不建议的并行

- `B6` 与 `A3` 同时改 `bootstrap.ts` / `pipeline-factory.ts` → 冲突。
- `D2` 与 `D3` 同时改 `task-engine.ts` → 冲突。
- `G2..G5` 同时改 `Element` 构造参数 → 冲突；按 pipeline 串行。
- `E5/E6` 同时改 `client-manager/index.ts` → 冲突；先抽文件再改 facade。

---

## 10. 风险热区

```mermaid
graph TB
    subgraph High["高风险"]
        ENGINE["task-engine.ts<br/>顺序 / 取消 / 事件"]
        LIFECYCLE["task-lifecycle.ts<br/>预算 / 检查点 / 链"]
        CM["client-manager/index.ts<br/>进程状态 / 重启"]
        BOOT["bootstrap.ts<br/>组合根 / 启动顺序"]
    end

    subgraph Medium["中风险"]
        FACTORY["pipeline-factory.ts<br/>pipeline 构造"]
        PROMPT["prompts/index.ts<br/>输出逐字一致"]
        SESSION["SessionContext<br/>窄接口兼容"]
        SERVER["server.ts<br/>startCore 签名"]
        GWS["gateway/server.ts<br/>生命周期"]
    end

    subgraph Low["低风险"]
        REG["pipeline/registry.ts"]
        STORE["pipeline/instance-store.ts"]
        WAKE["task/wakeup.ts"]
        THEME["tui-kit/theme.tsx"]
        DOCS["S11 文档"]
    end

    ENGINE --> LIFECYCLE
    BOOT --> FACTORY
    FACTORY --> PROMPT
    FACTORY --> REG
    ENGINE --> STORE
    ENGINE --> WAKE
    CM --> GWS
    BOOT --> SERVER
    SESSION --> FACTORY

    style ENGINE fill:#ffcdd2,stroke:#b71c1c
    style LIFECYCLE fill:#ffcdd2,stroke:#b71c1c
    style CM fill:#ffcdd2,stroke:#b71c1c
    style BOOT fill:#ffcdd2,stroke:#b71c1c
    style FACTORY fill:#ffe0b2,stroke:#e65100
    style PROMPT fill:#ffe0b2,stroke:#e65100
    style SESSION fill:#ffe0b2,stroke:#e65100
    style SERVER fill:#ffe0b2,stroke:#e65100
    style GWS fill:#ffe0b2,stroke:#e65100
    style REG fill:#c8e6c9,stroke:#2e7d32
    style STORE fill:#c8e6c9,stroke:#2e7d32
    style WAKE fill:#c8e6c9,stroke:#2e7d32
    style THEME fill:#c8e6c9,stroke:#2e7d32
    style DOCS fill:#c8e6c9,stroke:#2e7d32
```

| 热区 | 风险 | 原因 | 首要验证 |
|---|---|---|---|
| `task-engine.ts` | 极高 | 单循环改变调度与取消路径 | 顺序/取消/事件顺序测试 |
| `task-lifecycle.ts` | 极高 | 预算回滚、检查点、链调度 | 现有 `task-lifecycle.test.ts` + 双实例 |
| `client-manager/index.ts` | 极高 | 三种并发机制、无现有测试 | fake spawn/probe/timer |
| `bootstrap.ts` | 高 | 所有对象构造顺序 | 两个 startCore |
| `pipeline-factory.ts` | 高 | 5 条 pipeline 的 deps 透传 | pipeline 快照/单测 |
| `prompts/index.ts` | 高 | 输出逐字一致 | prompt 快照 |
| `SessionContext → PipelineSession` | 中 | 结构赋值遗漏 | typecheck + pipeline 测试 |
| `server.ts` | 中 | startCore 签名 | 现有 server 测试 |
| `gateway/server.ts` | 中 | start/stop 顺序 | gateway 测试 |

---

## 11. 回滚关系

```mermaid
graph LR
    H["S11-H 验收"] --> G["S11-G 窄接口"]
    H --> E["S11-E ProcessSupervisor"]
    H --> F["S11-F Theme"]
    G --> D["S11-D TaskEngine"]
    D --> C["S11-C PipelineInstanceStore"]
    C --> B["S11-B ElementRegistry"]
    B --> A["S11-A Services + Prompt"]

    H -.->|"revert"| RH["只回退测试/文档"]
    G -.->|"revert"| RG["恢复 Element 构造的 any<br/>保留运行时"]
    E -.->|"revert"| RE["恢复 ClientManager 旧并发<br/>健康检查只告警"]
    F -.->|"revert"| RF["删除 guard 测试"]
    D -.->|"revert"| RD["恢复事件重入 + 变异 FlowState"]
    C -.->|"revert"| RC["恢复 api/tasks pipelineMap"]
    B -.->|"revert"| RB["恢复模块级 registry"]
    A -.->|"revert"| RA["恢复 sm.get + prompt 单例"]

    style H fill:#c8e6c9,stroke:#2e7d32
    style G fill:#ffe0b2,stroke:#e65100
    style E fill:#ffe0b2,stroke:#e65100
    style F fill:#c8e6c9,stroke:#2e7d32
    style D fill:#ffe0b2,stroke:#e65100
    style C fill:#c8e6c9,stroke:#2e7d32
    style B fill:#c8e6c9,stroke:#2e7d32
    style A fill:#ffe0b2,stroke:#e65100
```

**回滚原则**:

- 每个任务一个 commit；回滚从后往前，不依赖后续任务。
- A/B/C 的过渡包装是“行为回滚点”：保留旧导出时，出问题可切回旧调用点。
- D 的回滚必须同时还原 `TaskEngine` 与 `PipelineInstanceStore` 注入（C2 之后）。
- E 的回滚保留 `ClientManager` 签名，只恢复内部旧并发实现。
- G 是类型层；回滚不影响运行时，但需恢复对应 `as any` 才可通过 typecheck。
- H 只回退测试/文档，不影响生产路径。

---

## 12. 测试覆盖图

```mermaid
graph LR
    subgraph Unit["单元"]
        U1["ElementRegistry 隔离"]
        U2["PromptRegistry 隔离/快照"]
        U3["PipelineInstanceStore CRUD"]
        U4["Wakeup 先通知/先等待"]
        U5["RestartPolicy 上限/退避"]
        U6["ProcessState 转移"]
    end

    subgraph Integration["集成"]
        I1["TaskEngine 顺序/取消/drain"]
        I2["FlowState 不可变"]
        I3["ClientManager start/stop/restart"]
        I4["HealthProbe 成功/失败/超时"]
        I5["Gateway 路由/鉴权不变"]
    end

    subgraph Acceptance["验收"]
        A1["两个 startCore 并行"]
        A2["两个 PromptRegistry"]
        A3["两个 PipelineInstanceStore"]
        A4["Theme import 图"]
        A5["Bun 全量测试"]
        A6["Node smoke + package"]
    end

    U1 --> A1
    U2 --> A2
    U3 --> A3
    U4 --> I1
    U5 --> I3
    U6 --> I3
    I1 --> A1
    I2 --> A1
    I3 --> I5
    I4 --> I3
    A4 --> A5
    A5 --> A6
```

**门禁**:

- 每个任务至少新增/更新一个目标测试；纯类型任务用 `typecheck` + 现有测试。
- D/E 的测试必须先于重构提交（失败测试 → 实现 → 通过）。
- H1 双实例是 S11 的出口条件，不是 S12 的补充。
- Node smoke 只验证构建/启动/package，不要求跑全部 `bun:test`。

---

## 13. 禁止的依赖边

```mermaid
graph TB
    subgraph Forbidden["禁止"]
        F1["core → gateway"]
        F2["gateway → core"]
        F3["shared → core / gateway"]
        F4["Element → 模块级 registry / prompt 单例"]
        F5["TaskEngine → api/tasks.ts"]
        F6["ClientManager 回调 → 直接 setTimeout spawn"]
        F7["tui → tui-kit 的反向依赖"]
        F8["任何新代码 → 模块级可变 Map"]
    end

    subgraph Allowed["允许"]
        A1["core → shared"]
        A2["gateway → shared"]
        A3["main → core / gateway / services"]
        A4["Element → PromptResolver / PipelineSession"]
        A5["TaskEngine → PipelineInstanceStore"]
        A6["ClientManager → ProcessSupervisor"]
        A7["tui / config-tui → tui-kit"]
    end

    style Forbidden fill:#ffcdd2,stroke:#b71c1c
    style Allowed fill:#c8e6c9,stroke:#2e7d32
```

**说明**:

- `core` 与 `gateway` 不能互相依赖；共享契约只下沉到 `shared` 或 core 的窄类型文件。
- Element 不能 import 具体 registry 实例或单例；只能接收窄接口/函数。
- TaskEngine 不能 import `api/tasks.ts`；HTTP 层与执行层分离。
- ClientManager 的 exit 回调不能直接重新 spawn；必须经过 supervisor 状态机。
- TUI 主题只能单向依赖 `tui-kit`。
- S11 后新增模块级可变状态视为失败（DoD 检查）。
