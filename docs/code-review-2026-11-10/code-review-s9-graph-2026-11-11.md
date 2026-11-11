# Atom Neo Code Review Graph — S9 HTTP/WS Runtime — 2026-11-11

> **Baseline**: `code-review/2026-11-10` @ `fc78eac` (v1.22.9)
> **Scope**: S9 的运行时关系、双实现、阶段依赖与风险热区
> **Related**:
> - [code-review-s9-2026-11-11.md](./code-review-s9-2026-11-11.md)
> - [code-review-s9-plan-2026-11-11.md](./code-review-s9-plan-2026-11-11.md)
> - [code-review-graph-2026-11-10.md](./code-review-graph-2026-11-10.md)

---

## 0. 图例

| 符号 | 含义 |
|---|---|
| 实线 | 直接依赖 / 调用 |
| 虚线 | 可选实现、动态导入或待删除路径 |
| 红色节点 | 当前阻断点 / 高风险 |
| 橙色节点 | 需要改造或重点验证 |
| 绿色节点 | 目标统一模块 |
| 灰色节点 | 禁区 / 范围外 |
| 蓝色节点 | 适配层实现 |

---

## 1. S9 边界图

```mermaid
graph TB
    subgraph InScope["S9 范围"]
        HTTP["Core HTTP"]
        WS["Core WebSocket"]
        ADMIN["Admin IP 鉴权"]
        GW["Gateway HTTP"]
        ENTRY["Node 入口 / 运行时选择"]
        TEST["双运行时契约测试"]
    end

    subgraph OutScope["S9 范围外"]
        BUILD["S10 Node 构建 / CI / 发布"]
        DI["S11 全局状态 / DI"]
        TUI["S12 TUI 结构重构"]
        FORBIDDEN["禁区: Replay / PipelineRunner / 未实现 Element"]
    end

    HTTP --> TEST
    WS --> TEST
    ADMIN --> TEST
    GW --> TEST
    ENTRY --> TEST
    TEST -.-> BUILD
    BUILD -.-> DI
    DI -.-> TUI
    FORBIDDEN -.->|"不改"| HTTP

    style HTTP fill:#ffe0b2,stroke:#e65100
    style WS fill:#ffe0b2,stroke:#e65100
    style ADMIN fill:#ffcdd2,stroke:#b71c1c
    style GW fill:#ffe0b2,stroke:#e65100
    style ENTRY fill:#ffe0b2,stroke:#e65100
    style TEST fill:#c8e6c9,stroke:#2e7d32
    style FORBIDDEN fill:#e0e0e0,stroke:#616161
```

**结论**：

- S9 只解决“传输”和“入口”，不解决构建/发布。
- 双运行时测试是 S9 的出口条件，不是 S10 的补充。
- 禁区代码不进入 S9 依赖链。

---

## 2. 当前运行时关系

```mermaid
graph TB
    subgraph Entry["入口"]
        MAIN["src/main.ts"]
        IMP["import.meta.main"]
    end

    subgraph Core["@atom-neo/core"]
        SC["startCore"]
        SRV["server.ts"]
        ROUTER["http-router.ts"]
        WSH["ws/handler.ts"]
        BCAST["ws/broadcaster.ts"]
        TASK["TaskSubmissionService / TaskEngine"]
    end

    subgraph Gateway["@atom-neo/gateway"]
        GS["startGateway"]
        GLOG["模块级 Logger"]
    end

    subgraph Shared["@atom-neo/shared"]
        ADMIN["admin-auth.ts"]
    end

    subgraph BunOnly["Bun 专有"]
        SERVE["Bun.serve / Bun.Server"]
        SW["ServerWebSocket"]
        RIP["srv.requestIP"]
        STOP["server.stop(false/true)"]
    end

    subgraph Client["客户端"]
        TUI["TUI fetch + WebSocket"]
        PLATFORM["平台 Client"]
    end

    MAIN --> SC
    MAIN --> GS
    IMP --> MAIN
    SC --> SRV
    SRV --> SERVE
    SRV --> ROUTER
    SRV --> WSH
    SRV --> STOP
    ROUTER --> RIP
    ROUTER --> ADMIN
    ROUTER --> TASK
    WSH --> SW
    BCAST --> SW
    ADMIN --> RIP
    GS --> SERVE
    GS --> GLOG
    GS --> RIP
    TUI --> ROUTER
    TUI --> WSH
    PLATFORM --> GS

    style SERVE fill:#ffcdd2,stroke:#b71c1c
    style SW fill:#ffcdd2,stroke:#b71c1c
    style RIP fill:#ffcdd2,stroke:#b71c1c
    style STOP fill:#ffcdd2,stroke:#b71c1c
    style GLOG fill:#ffe0b2,stroke:#e65100
```

**观察**：

- `startCore` 与 `startGateway` 都直接拥有传输，Node 入口没有注入点。
- `admin-auth` 被 Core 与 Gateway 共用，但签名绑定 Bun server。
- `TaskSubmissionService` 已经与传输解耦；S9 不应再改动它。

---

## 3. 目标运行时关系

```mermaid
graph TB
    subgraph Entry["入口"]
        MAIN["main.ts"]
        DETECT["resolveHttpRuntime()"]
        ENV["ATOM_HTTP_RUNTIME"]
    end

    subgraph Shared["@atom-neo/shared"]
        TYPES["http/types.ts"]
        FACTORY["createHttpServer()"]
        BUN["BunHttpServer"]
        NODE["NodeHttpServer"]
        PEER["WebSocketPeer"]
        ADMIN["isAdminRequest(req, ctx)"]
    end

    subgraph Core["@atom-neo/core"]
        SC["startCore"]
        ROUTER["CoreRouter: fetch / upgrade"]
        WSH["ws/handler.ts"]
        BCAST["ws/broadcaster.ts"]
        TASK["TaskSubmissionService / TaskEngine"]
    end

    subgraph Gateway["@atom-neo/gateway"]
        GS["startGateway(logger, httpServer)"]
    end

    subgraph Client["客户端"]
        TUI["TUI fetch + WebSocket"]
        PLATFORM["平台 Client"]
    end

    MAIN --> DETECT
    ENV --> DETECT
    DETECT --> FACTORY
    FACTORY --> BUN
    FACTORY -.->|"node runtime"| NODE
    SC --> FACTORY
    SC --> ROUTER
    ROUTER --> ADMIN
    ROUTER --> WSH
    WSH --> PEER
    BCAST --> PEER
    ROUTER --> TASK
    GS --> FACTORY
    GS --> ADMIN
    TUI --> ROUTER
    TUI --> WSH
    PLATFORM --> GS
    BUN -.->|"Bun.serve"| ROUTER
    NODE -.->|"node:http + ws"| ROUTER

    style TYPES fill:#c8e6c9,stroke:#2e7d32
    style FACTORY fill:#c8e6c9,stroke:#2e7d32
    style BUN fill:#e3f2fd,stroke:#1565c0
    style NODE fill:#e3f2fd,stroke:#1565c0
    style PEER fill:#c8e6c9,stroke:#2e7d32
    style ADMIN fill:#c8e6c9,stroke:#2e7d32
    style ROUTER fill:#c8e6c9,stroke:#2e7d32
```

**关键边**：

- `main.ts → resolveHttpRuntime → createHttpServer`：唯一运行时选择点。
- `startCore/startGateway → HttpServer`：只依赖契约，不依赖 Bun/Node。
- `CoreRouter.fetch/upgrade`：HTTP 与升级分流，适配器各自实现。
- `WebSocketPeer`：handler/broadcaster 只看 peer，不看 Bun/Node。

---

## 4. HTTP 请求生命周期

```mermaid
sequenceDiagram
    autonumber
    participant C as TUI / Gateway / Client
    participant S as HttpServer Adapter
    participant R as CoreRouter
    participant A as requireAdmin
    participant H as Handler
    participant T as TaskEngine

    C->>S: HTTP request
    S->>S: 构造 Request + ctx { runtime, ip, port }
    S->>R: fetch(req, ctx)
    R->>A: requireAdmin(req, ctx)
    A-->>R: undefined / 403
    alt forbidden
        R-->>S: 403 JSON
        S-->>C: 403
    else allowed
        R->>H: route handler
        H->>T: submit / status / attach
        T-->>H: result
        H-->>R: Response
        R-->>S: Response
        S-->>C: status + headers + body
    end
```

**Node 桥接点**：

- `IncomingMessage → Request`：method、URL、headers、body、abort signal。
- `Response → ServerResponse`：status、headers、`Set-Cookie`、204/304/HEAD、stream body。
- `ctx.ip` 来自 `socket.remoteAddress`，不读代理头。

---

## 5. WebSocket 升级生命周期

### 5.1 Bun 路径

```mermaid
sequenceDiagram
    autonumber
    participant C as TUI
    participant B as BunHttpServer
    participant R as CoreRouter
    participant H as ws/handler
    participant P as WebSocketPeer
    participant BC as Broadcaster

    C->>B: GET /ws/:sessionId + Upgrade
    B->>R: upgrade(req, ctx)
    alt invalid sid
        R-->>B: { response: 400 }
        B-->>C: 400
    else valid
        R-->>B: { data: { sessionId } }
        B->>B: srv.upgrade(req, { data })
        B-->>C: 101 Switching Protocols
        B->>H: open(peer)
        H->>BC: add(peer, sessionId)
        H->>P: send(session.ready)
        C->>P: task.submit / ping / cancel
        P->>H: message(peer, text)
    end
```

### 5.2 Node 路径

```mermaid
sequenceDiagram
    autonumber
    participant C as TUI
    participant N as node:http
    participant W as ws.WebSocketServer
    participant A as NodeHttpServer
    participant R as CoreRouter
    participant H as ws/handler

    C->>N: GET /ws/:sessionId + Upgrade
    N->>A: upgrade event (req, socket, head)
    A->>R: upgrade(toWebRequest(req), ctx)
    alt invalid sid
        R-->>A: { response: 400 }
        A->>N: write 400 + destroy socket
    else valid
        R-->>A: { data: { sessionId } }
        A->>W: handleUpgrade(req, socket, head)
        W-->>C: 101 Switching Protocols
        W->>A: connection(ws, req)
        A->>A: peer = peers.get(ws) ?? createPeer(ws, data)
        A->>H: open(peer)
        C->>A: message frame
        A->>H: message(peer, normalized text)
    end
```

**关键不变式**：

- Node 的 `peer` 必须按 `ws.WebSocket` 缓存；`open` / `message` / `close` 使用同一对象。
- `close` 与 `error` 都要调用 `broadcaster.remove(peer)`，且只清理一次。
- Bun 的 `ServerWebSocket` 可直接作为 peer；不额外包一层，避免身份不一致。

---

## 6. 模块依赖目标

```mermaid
graph LR
    subgraph SharedPkg["@atom-neo/shared"]
        TYPES["http/types.ts"]
        DETECT["http/detect.ts"]
        CREATE["http/create-http-server.ts"]
        BUN["http/bun-http-server.ts"]
        NODE["http/node-http-server.ts"]
        PEER["http/node-websocket-peer.ts"]
        ADMIN["utils/admin-auth.ts"]
    end

    subgraph CorePkg["@atom-neo/core"]
        ROUTER["http-router.ts"]
        WS["ws/handler.ts"]
        BC["ws/broadcaster.ts"]
        SERVER["server.ts"]
    end

    subgraph GatewayPkg["@atom-neo/gateway"]
        GWS["server.ts"]
    end

    subgraph Entry["src"]
        MAIN["main.ts"]
    end

    CREATE --> BUN
    CREATE --> NODE
    NODE --> PEER
    TYPES --> ROUTER
    TYPES --> WS
    TYPES --> BC
    ADMIN --> ROUTER
    ADMIN --> GWS
    ROUTER --> CREATE
    SERVER --> CREATE
    GWS --> CREATE
    MAIN --> CREATE
    MAIN --> SERVER
    MAIN --> GWS
```

**依赖方向**：

- `shared` 不依赖 `core` / `gateway`。
- `core` / `gateway` 只依赖 `shared` 的契约与工厂。
- Node adapter 的 `ws` 依赖只在 `shared/src/http` 内动态加载。
- `tui` 不依赖 `shared/src/http` 的服务端实现。

---

## 7. S9 阶段依赖与决策门

```mermaid
graph LR
    A["S9-A 契约 / 类型 + spike"] --> B["S9-B Bun Adapter"]
    B --> C["S9-C Node Adapter"]
    C --> D["S9-D Node 入口 / 运行时选择"]
    D --> E["S9-E 双运行时验收 / 清理"]

    A -.-> GATE{"ws on Bun spike"}
    GATE -.->|"通过"| UNIFIED["S9-E: 评估统一 node:http + ws"]
    GATE -.->|"失败"| DUAL["S9-E: 保留 Bun / Node 双实现"]
    UNIFIED -.-> E
    DUAL -.-> E

    B -.->|"回滚点"| RB1["恢复 Bun.serve"]
    C -.->|"回滚点"| RB2["移除 Node adapter / ws"]
    D -.->|"回滚点"| RB3["关闭 ATOM_HTTP_RUNTIME"]
    E -.->|"回滚点"| RB4["仅回退测试/文档"]

    style A fill:#c8e6c9,stroke:#2e7d32
    style B fill:#c8e6c9,stroke:#2e7d32
    style C fill:#ffe0b2,stroke:#e65100
    style D fill:#ffe0b2,stroke:#e65100
    style E fill:#c8e6c9,stroke:#2e7d32
    style GATE fill:#fff9c4,stroke:#f9a825
```

**顺序理由**：

- 先有契约，才能让 Bun 与 Node 共享 router/handler。
- 先有 Bun adapter，才能在“行为完全不变”的前提下验证契约。
- Node adapter 在 Bun 通过后再接，避免同时调试两套传输。
- 入口最后切换；即使入口有问题，adapter 仍可独立测试。

---

## 8. 文件与风险热区

```mermaid
graph TB
    subgraph High["高风险"]
        ROUTER["http-router.ts"]
        ADMIN["admin-auth.ts"]
        WSH["ws/handler.ts"]
        NODE["node-http-server.ts"]
    end

    subgraph Medium["中风险"]
        SERVER["server.ts"]
        GW["gateway/server.ts"]
        MAIN["main.ts"]
        BUN["bun-http-server.ts"]
        BC["ws/broadcaster.ts"]
    end

    subgraph Low["低风险"]
        TYPES["http/types.ts"]
        DETECT["http/detect.ts"]
        TESTS["双运行时 smoke"]
        DOCS["S9 文档"]
    end

    ROUTER --> ADMIN
    ROUTER --> WSH
    WSH --> BC
    SERVER --> ROUTER
    GW --> ADMIN
    MAIN --> SERVER
    MAIN --> GW
    NODE --> ROUTER
    BUN --> ROUTER
    TYPES --> ROUTER
    TYPES --> WSH
    DETECT --> MAIN

    style ROUTER fill:#ffcdd2,stroke:#b71c1c
    style ADMIN fill:#ffcdd2,stroke:#b71c1c
    style WSH fill:#ffcdd2,stroke:#b71c1c
    style NODE fill:#ffcdd2,stroke:#b71c1c
    style SERVER fill:#ffe0b2,stroke:#e65100
    style GW fill:#ffe0b2,stroke:#e65100
    style MAIN fill:#ffe0b2,stroke:#e65100
    style BUN fill:#ffe0b2,stroke:#e65100
    style BC fill:#ffe0b2,stroke:#e65100
```

| 热区 | 风险 | 原因 | 首要验证 |
|---|---|---|---|
| `http-router.ts` | 极高 | upgrade 拆分 + 所有路由 | 路由表逐条回归 |
| `admin-auth.ts` | 极高 | 403 误判会锁死 TUI | loopback/远端/IPv4-mapped |
| `ws/handler.ts` | 极高 | 协议入口 + peer 生命周期 | session.ready / task.submit |
| `node-http-server.ts` | 极高 | Request/Response 桥接 | body/headers/204/304/stream |
| `server.ts` | 高 | 两阶段 stop | drain / force close |
| `gateway/server.ts` | 高 | 独立传输 + admin | 鉴权/限流/stop |
| `main.ts` | 中 | 运行时选择 | Bun 默认 / Node 可选 |
| `bun-http-server.ts` | 中 | 现有行为唯一出口 | 与 `fc78eac` 逐项对比 |
| `ws/broadcaster.ts` | 中 | peer key / 清理 | 多连接/断开/发送失败 |

---

## 9. 测试覆盖图

```mermaid
graph LR
    subgraph Contract["契约层"]
        T1["HttpServer start/stop"]
        T2["upgrade decision"]
        T3["peer identity"]
        T4["message normalization"]
    end

    subgraph Router["路由层"]
        R1["health / metrics"]
        R2["admin 403/200"]
        R3["attach"]
        R4["tasks submit/status/cancel"]
        R5["sessions / schedules"]
        R6["404"]
    end

    subgraph WS["WS 层"]
        W1["session.ready"]
        W2["task.submit"]
        W3["task.cancel"]
        W4["ping/pong"]
        W5["compact"]
        W6["disconnect cleanup"]
    end

    subgraph Runtime["运行时"]
        B1["Bun regression"]
        N1["Node smoke"]
        N2["Gateway smoke"]
        N3["force shutdown"]
    end

    T1 --> R1
    T2 --> W1
    T3 --> W6
    T4 --> W2
    R2 --> B1
    R4 --> N1
    W1 --> N1
    W2 --> N1
    N1 --> N2
    N2 --> N3
    B1 --> N3
```

**门禁**：

- `bun:test` 继续覆盖契约、路由、WS、Core 启停。
- Node smoke 覆盖真实 `node:http` + `ws` 路径，不依赖 `bun:test`。
- 两边使用同一组场景和断言口径。

---

## 10. 回滚关系

```mermaid
graph LR
    E["S9-E 验收"] --> D["S9-D 入口"]
    D --> C["S9-C Node Adapter"]
    C --> B["S9-B Bun Adapter"]
    B --> A["S9-A 契约"]

    E -.->|"revert"| RE["删除 smoke / 文档变更"]
    D -.->|"revert"| RD["移除运行时选择 / 保留 adapter"]
    C -.->|"revert"| RC["移除 node adapter / ws 依赖"]
    B -.->|"revert"| RB["恢复 server.ts 内 Bun.serve"]
    A -.->|"revert"| RA["恢复 RouterServer / ServerWebSocket"]

    style E fill:#c8e6c9,stroke:#2e7d32
    style D fill:#ffe0b2,stroke:#e65100
    style C fill:#ffe0b2,stroke:#e65100
    style B fill:#c8e6c9,stroke:#2e7d32
    style A fill:#c8e6c9,stroke:#2e7d32
```

**原则**：

- 按子阶段 commit，回滚从后往前。
- S9-B 是行为回滚点：保留 Bun adapter 时，Node 出问题不影响 Bun。
- S9-C 是依赖回滚点：移除 `ws` 与 Node adapter 即恢复 Bun-only。
- S9-D 是入口回滚点：删除环境变量分支即可。
- S9-E 只回退测试/文档，不影响运行时。

---

## 11. 禁止的依赖边

```mermaid
graph TB
    subgraph Forbidden["禁止"]
        F1["core → gateway"]
        F2["gateway → core"]
        F3["shared → core"]
        F4["tui → node:http / ws 服务端"]
        F5["router → Bun / Node adapter"]
        F6["handler → Bun / Node 类型"]
    end

    subgraph Allowed["允许"]
        A1["core → shared"]
        A2["gateway → shared"]
        A3["core/gateway → HttpServer"]
        A4["adapter → shared types"]
        A5["entry → factory"]
    end

    style Forbidden fill:#ffcdd2,stroke:#b71c1c
    style Allowed fill:#c8e6c9,stroke:#2e7d32
```

**说明**：

- `core` 与 `gateway` 不能互相依赖；共享代码只能下沉到 `shared`。
- 路由层不能 import 具体 adapter；否则 Node/Bun 分支会渗透到业务。
- 业务 handler 不能 import `bun` 或 `ws` 类型；只能使用 `WebSocketPeer`。
- TUI 是客户端，不加载服务端 `node:http` / `ws` 实现。
