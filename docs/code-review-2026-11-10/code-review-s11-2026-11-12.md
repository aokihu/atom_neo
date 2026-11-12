# Atom Neo Code Review — S11 Global State / DI — 2026-11-12

> **Baseline**: `code-review/2026-11-10` @ `ef7ff15` (v1.22.12, S10 complete)
> **Scope**: CR-ARCH-01..09 中尚未收口的全局状态、构造方式与边界类型
> **Status**: S11-A1–A11、B/C/D/E/F 已实施；G/H 待实施
> **Related**:
> - [code-review-s11-graph-2026-11-12.md](./code-review-s11-graph-2026-11-12.md)
> - [code-review-s11-plan-2026-11-12.md](./code-review-s11-plan-2026-11-12.md)
> - [code-review-plan-2026-11-10.md](./code-review-plan-2026-11-10.md)
> - [dependency-injection.md](../standards/dependency-injection.md)

---

## 0. 使用说明

1. 本文只记录 S11 的问题、当前代码、目标契约与验收；实施步骤见 [S11 实施计划](./code-review-s11-plan-2026-11-12.md)。
2. 行号以 `ef7ff15` 为准，后续会漂移；定位优先搜索函数名、类型名和注释锚点。
3. `当前` 是基线代码；`目标` 是方向性契约，不要求逐字照抄。
4. CR-ARCH-04 / CR-ARCH-05 已在 S9-D / S5 关闭。本文保留其验收位置，S11 只做防回归，不重复改造。
5. CR-ARCH-07（`any`）**只**处理 Element 边界的 Session/Task/Memory 窄接口；全量 `any` 清理留给 S12。
6. S11 不做 CR-ARCH-10/11/12，不拆巨型文件，不改 TUI 布局。

### 稳定 ID

| 前缀 | 含义 |
|---|---|
| `S11-A1..A11` | 类型化 `Services` + `PromptRegistry` DI |
| `S11-B1..B7` | `ElementRegistry` 实例化 |
| `S11-C1..C3` | `PipelineInstanceStore` |
| `S11-D1..D7` | `TaskEngine` 单循环 / FlowState 不可变 |
| `S11-E1..E7` | `ClientManager → ProcessSupervisor` |
| `S11-F1` | TUI ThemeContext 防回归 |
| `S11-G1..G6` | Element 边界窄接口 |
| `S11-H1..H7` | 双实例验收、清理、文档 |

### 当前计数（2026-11-12 实测）

```bash
rg -n '\bany\b' src/packages/core/src --glob '!**/*.test.*' --glob '!**/dist/**' | wc -l
# 173（其中 as any / : any / <any> / any[] 形态 140）

rg -n 'session\??\s*:\s*any|task\??\s*:\s*any|memory\??\s*:\s*any' src/packages/core/src --glob '!**/*.test.*' --glob '!**/dist/**' | wc -l
# 62；仅 pipelines/ 下为 48

rg -n 'registerElement\(|resolveElement\(|getRegisteredNames\(|clearRegistry\(' src --glob '!**/*.test.*' --glob '!**/dist/**' | wc -l
# 34（生产代码；含测试 95）

rg -n 'resolvePrompt\(' src --glob '!**/*.test.*' --glob '!**/dist/**' | wc -l
# 9（生产调用点，不含 shared/prompts/index.ts 定义）

rg -n 'getRegistry\(|initPromptRegistry\(' src --glob '!**/*.test.*' --glob '!**/dist/**' | wc -l
# 5

rg -n 'getPipeline\(|setPipeline\(|removePipeline\(|pipelineMap' src --glob '!**/dist/**' | wc -l
# 11（7 个定义/API 行 + 4 个 task-engine 调用点）
```

> 原审查记录为 `any` ~140、`session/task/memory: any` ~47、registry 调用 ~43、prompt 调用 ~24、pipelineMap ~8。数字已随 S1–S10 变化，实施时以最新实测为准；不要为了凑旧数字而扩大范围。

---

## 1. 结论与范围

### 结论

S11 不是“一次性去全局化”，而是把**组合根**从模块作用域搬到显式对象：

```text
main.ts
  ├── ServiceManager（只负责生命周期）
  ├── CoreServices（显式类型化依赖）
  └── startCore({ services, ... })
        ├── PromptRegistry（每实例一份）
        ├── ElementRegistry（每实例一份）
        ├── PipelineInstanceStore（每实例一份）
        ├── TaskEngine（单循环，注入 store）
        └── createCoreBootstrap（只组装，不读全局）
```

Gateway 侧独立为：

```text
startGateway({ logger, httpServer })
  └── ClientManager
        └── ProcessSupervisor（每 client 一个状态机）
```

必须拆成 S11-A..H 八个子阶段；每个任务保持 **简单 / 中等**，单 commit 可回退。原计划“5–8 天”只覆盖 registry/prompt 的主路径；加入 ProcessSupervisor、窄接口和双实例验收后，现实总量更大（见实施计划估算）。

### 范围内

- `ElementRegistry` 实例化并注入 pipeline 构造。
- `PipelineInstanceStore` 替代 `api/tasks.ts` 的模块级 `pipelineMap`。
- `PromptRegistry` 实例化，移除懒初始化单例。
- 类型化 `CoreServices`，`startCore` 接收显式依赖。
- `TaskEngine` 单循环 + 唤醒 Promise + FlowState 不可变。
- `ClientManager` 拆出 `ProcessSupervisor` 状态机、重启策略、健康检查。
- TUI ThemeContext 的防回归检查（S5 已迁移）。
- Element 边界的 Session/Task 窄接口。
- 双实例/双 registry/双 store 验收，文档与回滚说明。

### 范围外（S12 / 后续）

- CR-ARCH-10：TUI App Modal 配置表。
- CR-ARCH-11：WizardApp reducer / 路由守卫。
- CR-ARCH-12：`stream-llm.ts` God Function。
- CR-STR-01..11：`memory-service`、`context-service`、`persistence-service`、TUI 组件等巨型文件拆分。
- CR-DUP-11/12：工具执行与消息投影统一。
- 全量 `any` 清理（core 生产代码仍有 140 处 `: any` 形态）。
- 删除 `PipelineRunner` / `PipelineManager` / `PipelineRecorder` / `Replay`。
- 全部 `bun:test` 迁移到 Node。
- 引入 DI 容器、装饰器、反射注入。

### 与 S12 的边界

| 事项 | S11 | S12 |
|---|---|---|
| Element 注册表全局 | 实例化并注入 | 不再改构造 |
| TaskEngine 事件重入 | 单循环 + 唤醒 + `TaskRunner` | 不改调度语义 |
| ClientManager | 拆 `ProcessSupervisor` | 可继续缩短 `index.ts` |
| `any` | 仅 Element 边界窄接口 | 全量清理与类型收口 |
| 巨型文件 | 不动 | 按文件拆分 |
| TUI 布局/Modal | 不动 | 结构重构 |

---

## 2. 当前全局状态清单

| ID | 当前实现 | 位置 | 全局副作用 | S11 目标 |
|---|---|---|---|---|
| CR-ARCH-01 | 模块级 `registry = new Map()` | `src/packages/core/src/pipeline/registry.ts:5` | 两次 `startCore` 共享注册表；测试需 `clearRegistry()` | `ElementRegistry` 实例 |
| CR-ARCH-02 | 模块级 `pipelineMap` | `src/packages/core/src/api/tasks.ts:8-20` | TaskEngine 依赖 HTTP 层；测试互相污染 | `PipelineInstanceStore` 注入 |
| CR-ARCH-03 | 已由 S11-A6–A11 删除；改为 per-Core registry + resolver | `src/packages/shared/src/prompts/index.ts` | 已消除 | `createPromptRegistry()` + `PromptResolver` |
| CR-ARCH-04 | Gateway 模块级 Logger | 已在 S9-D 删除 | import 无副作用已满足 | 仅防回归测试 |
| CR-ARCH-05 | ThemeContext 在 `App.tsx` | 已在 S5 移到 `tui-kit/src/theme.tsx` | 循环依赖已解除 | 仅 import 图防回归 |
| CR-ARCH-06 | 字符串 ServiceManager | `src/services/service-manager.ts:18-20`、`bootstrap.ts:102-109` | `sm.get("memory")` 无类型；缺失服务延迟失败 | `CoreServices` + 显式注入 |
| CR-ARCH-07 | Element 边界 `session/task/memory: any` | `pipelines/**` 48 处 → 0（S11-G） | 类型失真；重构无编译保护 | 窄 `PipelineSession` + `TaskItem` |
| CR-ARCH-08 | 事件重入 + 变异 FlowState | `task-engine.ts:91-100,142-167` | 递归调度；输入对象被写入 `abortSignal` | 单循环 + 不可变 FlowState |
| CR-ARCH-09 | 三种并发机制混合 | `gateway/src/client-manager/index.ts` | exit/timer/serialize/health 相互竞争 | `ProcessSupervisor` 状态机 |

### 当前构造链（节选）

```ts
// src/packages/core/src/bootstrap.ts
const memory = sm.get("memory");
const skillService = sm.get<SkillServiceLike>("skill");
const network = sm.get<NetworkServiceLike>("network");
if (!network) throw new Error('Required service "network" is not registered');
const getCompiledPrompt = () => {
  const compiler = sm.get<CompilerLike>("agents-compiler");
  return compiler?.getCompiledPrompt() ?? "";
};
```

```ts
// src/packages/core/src/server.ts
export async function startCore(deps: CoreDeps & { httpServer?: HttpServer }): Promise<CoreHandle> {
  const core = createCoreBootstrap({ ...deps, isStopping });
  // ...
}
```

---

## 3. 问题清单（CR-ARCH-01..09）

### CR-ARCH-01 — ElementRegistry 是模块级全局

**级别**: P2 · **阶段**: S11-B · **当前状态**: 已解决（2026-11-12，S11-B）

**实施**: 模块级 Map 与旧自由函数已删除；每个 Core 使用独立 `ElementRegistry`，7 个注册函数与 `PipelineBuilder`/`pipeline()` 显式接收实例。

**位置**: `src/packages/core/src/pipeline/registry.ts:5-30`；注册调用分布在
`src/packages/core/src/pipelines/{conversation,prediction,follow-up,follow-up-evaluator,context-compress,post-conversation,shared}/index.ts`。

**当前**:

```ts
const registry = new Map<string, ElementConstructor>();

export function registerElement(name: string, ctor: ElementConstructor): void {
  if (registry.has(name)) {
    throw new Error(`Element "${name}" already registered`);
  }
  registry.set(name, ctor);
}

export function resolveElement(name: string): ElementConstructor {
  const ctor = registry.get(name);
  if (!ctor) {
    throw new Error(
      `Element "${name}" not found. Registered: [${[...registry.keys()].join(", ")}]`,
    );
  }
  return ctor;
}
```

```ts
// src/packages/core/src/pipelines/conversation/index.ts
export function registerConversationElements(): void {
  registerElement("collect-prompts", CollectPromptsElement);
  // ... 12 个
}
```

**问题**:

- 两次 `startCore` 会竞争同一张表；第二次注册直接抛 `already registered`。
- 测试必须 `clearRegistry()`，测试之间无法并行。
- 无法按实例替换 Element（A/B 测试、插件化、热重载都受限制）。
- `PipelineBuilder` 直接 import 全局 `resolveElement`，构造路径不可注入。

**目标**:

```ts
export class ElementRegistry {
  #elements = new Map<string, ElementConstructor>();

  register(name: string, ctor: ElementConstructor): void {
    if (this.#elements.has(name)) {
      throw new Error(`Element "${name}" already registered`);
    }
    this.#elements.set(name, ctor);
  }

  resolve(name: string): ElementConstructor {
    const ctor = this.#elements.get(name);
    if (!ctor) {
      throw new Error(
        `Element "${name}" not found. Registered: [${this.names().join(", ")}]`,
      );
    }
    return ctor;
  }

  names(): string[] {
    return [...this.#elements.keys()];
  }

  clear(): void {
    this.#elements.clear();
  }
}

export function createElementRegistry(): ElementRegistry {
  return new ElementRegistry();
}
```

**契约**:

- 注册函数签名改为 `registerConversationElements(registry: ElementRegistry): void`。
- `PipelineBuilder` 构造时接收 registry；`pipeline(name, registry)` 为工厂入口。
- bootstrap 创建一个实例，传给所有注册函数与 pipeline factory。
- 模块级 `registerElement` / `resolveElement` / `clearRegistry` 先保留为过渡包装（legacy 实例），全部迁移后再删除。
- 保留错误文案：重复注册 `already registered`，缺失 `not found. Registered: [...]`。

**验收**:

- 两个 `ElementRegistry` 各自注册同名 Element 不冲突。
- 两个 `startCore` 并行启动不触发 `already registered`。
- `rg 'clearRegistry' src --glob '!**/*.test.*'` 为 0。

---

### CR-ARCH-02 — `pipelineMap` 全局且造成分层倒置

**级别**: P2 · **阶段**: S11-C · **当前状态**: 已解决（2026-11-12，S11-C）

**实施**: `pipelineMap` 与三个自由函数已删除；`TaskEngine` 注入 `PipelineInstanceStore`，bootstrap 每个 Core 创建一个实例，任务结束/取消后清理。

**位置**: `src/packages/core/src/api/tasks.ts:8-20`、`src/packages/core/src/task-engine.ts:5,69,138,143-150`。

**当前**:

```ts
// api/tasks.ts
const pipelineMap = new Map<string, Pipeline>();

export function getPipeline(taskId: string): Pipeline | undefined {
  return pipelineMap.get(taskId);
}

export function removePipeline(taskId: string): void {
  pipelineMap.delete(taskId);
}

export function setPipeline(taskId: string, pipeline: Pipeline): void {
  pipelineMap.set(taskId, pipeline);
}
```

```ts
// task-engine.ts
import { getPipeline, removePipeline, setPipeline } from "./api/tasks";

async #executeTask(task: TaskItem, abortSignal: AbortSignal): Promise<any> {
  let pipeline = getPipeline(task.id);
  if (!pipeline && task.pipeline) {
    const builder = this.#pipelineBuilders[task.pipeline];
    if (builder) {
      pipeline = builder(task);
      if (pipeline) setPipeline(task.id, pipeline);
    }
  }
  // ...
}
```

**问题**:

- TaskEngine 是执行层，却依赖 `api/tasks.ts`（HTTP 层）。
- 全局 Map 无生命周期边界；两个 Core 实例的 task id 可能碰撞。
- 测试无法隔离，也无法观察缓存命中/淘汰。
- `pipelineMap` 只增不减？实际在 finally 删除，但失败路径/取消路径依赖调用顺序。

**目标**:

```ts
// src/packages/core/src/pipeline/instance-store.ts
export class PipelineInstanceStore {
  #pipelines = new Map<string, Pipeline>();

  get(taskId: string): Pipeline | undefined {
    return this.#pipelines.get(taskId);
  }

  set(taskId: string, pipeline: Pipeline): void {
    this.#pipelines.set(taskId, pipeline);
  }

  delete(taskId: string): void {
    this.#pipelines.delete(taskId);
  }

  get size(): number {
    return this.#pipelines.size;
  }

  clear(): void {
    this.#pipelines.clear();
  }
}
```

**注入点**:

- `TaskEngine` 构造参数 `pipelineStore: PipelineInstanceStore`。
- `createCoreBootstrap` 创建一个实例并传给 TaskEngine。
- `api/tasks.ts` 不再保存 pipeline；HTTP 路由不读取它，因此无需注入 router（若未来状态查询需要，复用同一个实例）。

**验收**:

- 两个 store 的 `set/get/delete` 互不影响。
- TaskEngine 成功、失败、取消、drain 后 `store.size === 0`。
- `rg 'pipelineMap' src` 为 0。

---

### CR-ARCH-03 — PromptRegistry 单例 + 懒初始化

**级别**: P2 · **阶段**: S11-A · **当前状态**: 已解决（S11-A6–A11）

**位置**: `src/packages/shared/src/prompts/index.ts:13-34`、`src/packages/shared/src/prompts/registry.ts:7-46`。

**当前**:

```ts
let _instance: PromptRegistry;

export function getRegistry(): PromptRegistry {
  if (!_instance) _instance = new PromptRegistry();
  return _instance;
}

export function initPromptRegistry(): void {
  const r = getRegistry();
  r.registerLangBases("zh", zhBases);
  r.registerLangBases("en", enBases);
  r.registerModelRefinements("deepseek-v4-pro", deepseekV4ProRefinements);
  // ...
}

export function resolvePrompt(key: PromptKey, providerModel?: string): string {
  const [provider = "openai", model = "gpt-4o"] = (providerModel ?? "openai/gpt-4o").split("/");
  return getRegistry().resolve(key, provider, model);
}
```

**问题**:

- 构造发生在第一次 `resolvePrompt` 调用，失败点不可控。
- 两个 Core 实例无法拥有不同语言/模型变体（测试、平台定制）。
- Element 直接 import 自由函数，无法替换注册表。
- `initPromptRegistry()` 在 bootstrap 调用一次；如果测试先调用 `resolvePrompt`，会得到空注册表并缓存空字符串。

**目标**:

```ts
// shared/src/prompts/index.ts
export class PromptRegistry { /* 现有实现，保持缓存语义 */ }

export function createPromptRegistry(): PromptRegistry {
  const registry = new PromptRegistry();
  registry.registerLangBases("zh", zhBases);
  registry.registerLangBases("en", enBases);
  registry.registerModelRefinements("deepseek-v4-pro", deepseekV4ProRefinements);
  registry.registerModelRefinements("deepseek-v4-flash", deepseekV4FlashRefinements);
  registry.registerModelRefinements("gpt-4o", gpt4oRefinements);
  registry.registerModelRefinements("claude-sonnet", claudeSonnetRefinements);
  return registry;
}

export type PromptResolver = (key: PromptKey, providerModel?: string) => string;

export function createPromptResolver(registry: PromptRegistry): PromptResolver {
  return (key, providerModel) => {
    const [provider = "openai", model = "gpt-4o"] = (providerModel ?? "openai/gpt-4o").split("/");
    return registry.resolve(key, provider, model);
  };
}
```

**注入方式**:

- `createCoreBootstrap` 调用 `createPromptRegistry()`，创建 `promptResolver`。
- `createPipelineFactory` 接收 `promptResolver`，传给各 pipeline deps。
- Element 构造参数增加 `promptResolver: PromptResolver`（或 `resolvePrompt` 命名）。
- 过渡期保留 `resolvePrompt` 旧导出；所有生产调用点迁移后删除 `_instance` / `getRegistry` / `initPromptRegistry`。
- 不改变 `PromptRegistry` 的 key 格式、语言 fallback、模型 refinement 顺序和缓存语义；同一 provider/model 的输出必须逐字一致。

**验收**:

- 两个 `PromptRegistry` 独立注册不同变体，互不污染。
- `rg 'getRegistry\\(|initPromptRegistry\\(' src` 为 0（生产 + 测试）。
- 同一 prompt key/provider/model 在迁移前后输出完全一致（快照/字符串比较）。

**实施记录（S11-A6–A11）**:

- `createPromptRegistry()` 在 `shared/src/prompts/index.ts` 注册全部语言/模型变体；`createPromptResolver()` 绑定单个 registry 并保留 `openai/gpt-4o` 默认与未知 provider 的 `en` fallback。
- `_instance` / `getRegistry()` / `initPromptRegistry()` / 自由 `resolvePrompt()` 与旧 barrel 导出已删除。
- `createCoreBootstrap` 每个实例创建 registry + resolver，传入 `createPipelineFactory`；pipeline deps、`chooseDecision`、`callLLM` 与 JEV 模拟均显式接收 resolver。
- `prompts.test.ts` 覆盖双 registry 隔离、后续注册隔离、默认/显式/空 providerModel 与逐字一致输出。

---

### CR-ARCH-04 — Gateway 模块级 Logger（已由 S9-D 关闭）

**级别**: P2 · **阶段**: S11-H5（仅防回归） · **当前状态**: 已解决

**位置**: `src/packages/gateway/src/server.ts:28-30`。

**当前**:

```ts
const config = loadGatewayConfig(configOverrides);
const logger = configOverrides?.logger ?? new Logger("info", () => {});
const httpServer = configOverrides?.httpServer ?? await createHttpServer();
```

**结论**:

- 模块级 `logHub` / `StdoutSink` / `Logger` 已在 S9-D 删除。
- `startGateway({ logger })` 可注入；默认 logger 静默；仅入口创建 stdout logger。
- S11 不重复改造，只增加静态检查/测试，防止再次引入模块级 logger。

**验收**:

- import `@atom-neo/gateway` 不产生 stdout。
- `startGateway({ logger: silent })` 无日志噪音。
- `rg 'const logger = new Logger' src/packages/gateway/src/server.ts` 只在函数内、不在模块顶层。

---

### CR-ARCH-05 — TUI ThemeContext 循环依赖（已由 S5 关闭）

**级别**: P2 · **阶段**: S11-F（仅防回归） · **当前状态**: 已解决

**位置**: `src/packages/tui/src/components/App.tsx:6,71,120`、`src/packages/tui-kit/src/theme.tsx:145-162`。

**当前**:

```tsx
// tui/src/components/App.tsx
import { ThemeProvider, getTheme } from "@atom-neo/tui-kit";
// ...
const theme = useMemo(() => getTheme(serverInfo.theme), [serverInfo.theme]);
return <ThemeProvider value={theme}>...</ThemeProvider>;
```

```tsx
// tui-kit/src/theme.tsx
const ThemeContext = createContext<ThemeValue>(getTheme());
export function ThemeProvider(...) { /* ... */ }
export function useTheme(): ThemeValue { return useContext(ThemeContext); }
```

**结论**:

- ThemeContext 已在 `@atom-neo/tui-kit`，`tui` 组件统一从 `tui-kit` 导入 `useTheme`。
- 原 19 个从 `./App` 导入 `useTheme` 的调用已消失。
- S11 只增加 import 图防回归测试；若测试发现残留，再按 `S11-F1` 的最小改动修复。

**验收**:

- `rg 'from "\\.\\./App"|from "\\./App"' src/packages/tui/src` 只允许测试文件。
- `useTheme` 在 `tui/src` 的出现全部来自 `@atom-neo/tui-kit`。
- `tui-kit` 不反向依赖 `tui`。

---

### CR-ARCH-06 — ServiceManager 是字符串服务定位器

**级别**: P2 · **阶段**: S11-A · **当前状态**: 未解决

**位置**: `src/services/service-manager.ts:18-20`、`src/packages/core/src/bootstrap.ts:102-109`、`src/main.ts:174-181,203`。

**当前**:

```ts
export class ServiceManager {
  #services = new Map<string, BaseService>();

  get<T>(name: string): T | undefined {
    return this.#services.get(name) as unknown as T | undefined;
  }
}
```

```ts
// bootstrap.ts
const memory = sm.get("memory");                 // any
const skillService = sm.get<SkillServiceLike>("skill");
const network = sm.get<NetworkServiceLike>("network");
if (!network) throw new Error('Required service "network" is not registered');
const compiler = sm.get<CompilerLike>("agents-compiler");
```

**问题**:

- `sm.get("memory")` 无类型，拼写错误只在运行时暴露。
- 缺失服务延迟到具体工具调用才失败；启动可能半初始化。
- Core 依赖字符串协议，无法静态检查依赖。
- ServiceManager 同时承担“容器”和“生命周期”两个职责。

**目标**:

```ts
// src/packages/core/src/core-services.ts
import type { MemoryKind, MemoryNode } from "@atom-neo/shared";

export type MemoryTraversalResult = MemoryNode & {
  sourceId: string | null;
  relation: string | null;
  direction: "incoming" | "outgoing" | null;
  depth: number;
};

export type MemoryServiceLike = {
  search(query: string, limit?: number, kind?: MemoryKind): Promise<MemoryNode[]>;
  getById(id: string): MemoryNode | null;
  recordRead?(id: string): void;
  countRelated?(id: string): number;
  save(content: string, tags?: string[], summary?: string, options?: Record<string, unknown>): string;
  traverse(startId: string, maxSteps?: number): MemoryTraversalResult[];
  link(source: string, target: string, relation: string): boolean;
  forget(id: string): boolean;
  retain(id: string): void;
  findFullId?(id: string): string | null;
  has?(id: string): boolean;
};

export type CoreServices = {
  memory: MemoryServiceLike;
  network: NetworkServiceLike;
  skill?: SkillServiceLike;
  compiler?: { getCompiledPrompt(): string };
};
```

```ts
// server.ts / bootstrap.ts 目标
export type CoreDeps = {
  // ...
  services: CoreServices;
};

export function createCoreBootstrap(options: CoreBootstrapOptions) {
  const { memory, network, skill, compiler } = options.services;
  const getCompiledPrompt = () => compiler?.getCompiledPrompt() ?? "";
  // ...
}
```

**约束**:

- `ServiceManager` 继续负责 `register/startAll/stopAll`，但 `startCore` 不再接收它。
- `main.ts` 从具体服务实例构造 `CoreServices` 对象；`ServiceManager` 仍持有同一批实例做启停。
- `memory`、`network` 必填；`skill`、`compiler` 可选（保持现有“无 skill 也能启动”“无 compiler 空 prompt”的行为）。
- 缺失必填服务在 `startCore` 入口 fail-fast，错误信息包含服务名；已启动服务由 `main.ts` 的 `shutdown` 回滚。
- 不引入 DI 容器、不引入字符串 token 类型系统、不做自动扫描。

**验收**:

- 删除 `sm.get` 在 `core` 包内的所有调用。
- 缺少 `memory` 或 `network` 时 `startCore` 立即抛错，且 `main.ts` 停止已启动服务。
- `bun run typecheck` 对拼写错误在编译期报错。

---

### CR-ARCH-07 — 具体 Session 耦合与 `any`（S11 只做窄接口）

**级别**: P2 · **阶段**: S11-G · **当前状态**: Element 边界已解决（S11-G）；全量 `any` 清理留给 S12

**位置**: `pipelines/**` Element 边界 `session/task/memory: any` 已由 48 处降为 0；剩余非 Element `any` 按 S12 处理，典型历史示例：

```ts
// src/packages/core/src/pipelines/conversation/elements/types.ts:30-33
export type ConversationFlowState = {
  mode: ConversationMode;
  task: any;
  // ...
};

// src/packages/core/src/pipelines/conversation/elements/record-context.ts:30
constructor(params: { /* ... */ session?: any; /* ... */ }) {}

// src/packages/core/src/pipelines/prediction/elements/types.ts:15-16
export type PredictionFlowState = {
  mode: PredictionMode;
  task: any;
  session: any;
  // ...
};
```

**问题**:

- Element 直接拿整个 `SessionContext`，无法知道实际依赖；`any` 让删除/重命名方法无编译错误。
- 测试构造 session 需要完整类或 `as any`。
- 全量清理会牵动 `stream-llm`、`memory-service`、`pipeline-factory`，与 S12 巨型文件拆分冲突。

**目标（S11 范围）**:

```ts
// src/packages/core/src/session/element-session.ts
import type { ContinuationContext, SessionMessage, TodoItem } from "@atom-neo/shared";
import type { ExecutionBudget } from "./types";

/** Element 只依赖的 Session 能力；不是 SessionStore / HTTP 的通用接口。 */
export interface PipelineSession {
  readonly sessionId: string;
  readonly messages: readonly SessionMessage[];
  readonly todoState: readonly TodoItem[];
  readonly currentTopic: string | null;
  readonly tokenUsage: Readonly<{ total: number }>;
  readonly contextTokens: number;
  readonly pendingPrediction?: unknown;
  readonly originalSource?: string;
  readonly postCheckFingerprints: readonly string[];
  readonly compressing: boolean;
  compressRetry: number;
  compressRatio: number;
  legacyBudgetDepth?: number;
  executionBudget?: ExecutionBudget;

  addMessage(message: SessionMessage): void;
  removeMessages(seqs: readonly number[]): number;
  addTokenUsage(total: number): void;
  markSafeMessageCount(): void;
  setContextTokens(total: number): void;
  setTodoState(items: TodoItem[]): void;
  resetForNewTopic(topic: string): void;
  addPostCheckFingerprint(fp: string): void;
  clearContinuationContext(): void;
}

/** Element 只依赖的 Task 形状；与 shared TaskItem 保持一致。 */
export type ElementTask = import("@atom-neo/shared").TaskItem;
```

**约束**:

- 只替换 Element 构造参数、FlowState 的 `task/session`、pipeline deps 的 `task/session`。
- 不替换 `stream-llm` 内部局部 `any`、`pipeline-factory` 的 `RuntimeLike.appConfig`、`tools/builtin/memory.ts` 的所有 `any`。
- `PipelineSession` 是 `SessionContext` 的结构超集/子集？必须是 `SessionContext` 可直接赋值的结构（编译期验证）。
- 每批迁移后运行对应 pipeline 测试；不用一次性全改。
- 目标不是“消除 140 个 any”，而是“Element 边界有类型，S12 可安全拆文件”。

**验收**:

- `pipelines/**` 的 `session/task: any` 从 48 降到 0（memory 可保留在工具层）。
- `SessionContext` 可直接传给所有 Element 构造参数（无 `as any`）。
- 全量测试与 S11 前行为一致。

---

### CR-ARCH-08 — TaskEngine 事件重入 + 变异输入

**级别**: P2 · **阶段**: S11-D · **当前状态**: 已解决（2026-11-12，S11-D）

**实施**: `TaskEngine` 改为单一 `#runLoop` + `Wakeup`（notify-before-wait，无 timer/轮询）；`Task.Enqueued` 只唤醒；单任务执行抽到 `TaskRunner`，每个 Element 收到 `{ ...current, abortSignal }` 新对象，最终结果剥离 `abortSignal`；递归 `#onTaskEnqueued`、`#processing`、`#processNext` 与未使用 `#timeoutMs` 已删除。

**位置**: `src/packages/core/src/task-engine.ts`、`src/packages/core/src/task/task-runner.ts`。

**当前**:

```ts
#onTaskEnqueued(): void {
  if (!this.#running || this.#processing || this.#queue.size === 0) return;
  this.#processing = true;
  Promise.resolve()
    .then(() => this.#processNext())
    .finally(() => {
      this.#processing = false;
      this.#onTaskEnqueued();
    });
}

async #executeTask(task: TaskItem, abortSignal: AbortSignal): Promise<any> {
  // ...
  let current: any = { mode: "initial", task };
  for (const element of pipeline.elements) {
    this.#throwIfCancelled(abortSignal);
    current.abortSignal = abortSignal;       // 变异输入
    current = await element.process(current);
    this.#throwIfCancelled(abortSignal);
  }
  // ...
}
```

**问题**:

- 事件处理器递归调用自身；`#processing` 是隐式状态，异常路径容易丢唤醒。
- 每次 `Task.Enqueued` 都可能启动一个 microtask；很难证明串行。
- `current.abortSignal = abortSignal` 直接写 Element 输入；若 element 保留引用，会跨任务污染。
- `#timeoutMs` 构造参数当前未使用；S11 不改变超时行为，只记录为遗留。
- `#processNext` 与 `#onTaskEnqueued` 的职责交织，无法单独测试“执行一个 task”。

**目标**:

```ts
// src/packages/core/src/task/wakeup.ts
export class Wakeup {
  #pending = false;
  #resolve?: () => void;

  notify(): void {
    if (this.#resolve) {
      const resolve = this.#resolve;
      this.#resolve = undefined;
      resolve();
    } else {
      this.#pending = true;
    }
  }

  async wait(): Promise<void> {
    if (this.#pending) {
      this.#pending = false;
      return;
    }
    await new Promise<void>((resolve) => { this.#resolve = resolve; });
  }
}
```

```ts
start(): void {
  if (this.#running) return;
  this.#running = true;
  this.#loopPromise = this.#runLoop();
}

async #runLoop(): Promise<void> {
  while (this.#running) {
    const task = this.#queue.dequeue();
    if (!task) {
      await this.#wake.wait();
      continue;
    }
    await this.#processTask(task);
  }
}

#onTaskEnqueued(): void {
  if (this.#running) this.#wake.notify();
}
```

```ts
// FlowState 不可变
let current: unknown = { mode: "initial", task };
for (const element of pipeline.elements) {
  this.#throwIfCancelled(abortSignal);
  current = await element.process({ ...(current as object), abortSignal });
  this.#throwIfCancelled(abortSignal);
}
```

**约束**:

- 保持 `start(): void`、`stop(): void`、`drain()` 的公开签名；`start` 幂等。
- 保持任务顺序：active 队列优先、同优先级 active 取最新（`TaskQueue.dequeue` 不变）。
- 保持事件顺序：`Activated` → `Completed`/`Failed`；`Pipeline.Result` 仅在成功时发出。
- 保持取消语义：同 session 同 chain 的 queued + processing；`TaskCancelledError` 文案/code 不变。
- `drain()` 仍轮询到 `queue.size === 0`；超时返回 false 并停止等待，不停止引擎，调用方可重试。
- 不新增任务超时；`#timeoutMs` 暂保留或在本阶段末尾删除（需单独任务，避免行为变化）。

**验收**:

- 并发 enqueue 10 个任务，`maxProcessing === 1`，完成顺序符合 `TaskQueue` 规则。
- enqueue → stop → start 不丢任务、不重复执行。
- 取消运行中/排队中任务的行为与基线测试一致。
- FlowState 测试：Element 收到的是新对象，输入对象未被写入 `abortSignal`。

---

### CR-ARCH-09 — ClientManager 三种并发机制混合

**级别**: P2 · **阶段**: S11-E · **当前状态**: 未解决

**位置**: `src/packages/gateway/src/client-manager/index.ts:131-149,151-205,207-239,247-261`。

**当前**:

```ts
// onExit 回调
onExit: (exitCode, signalCode, error) => {
  // ...
  if (entry?.killed || this.#stopping || !this.#desired.has(id)) return;
  this.#scheduleRestart(cc);
}

// setTimeout 重启
#scheduleRestart(cc: ClientConfig): void {
  this.#restarts.set(id, setTimeout(() => {
    // ...
    void this.#serialize(id, async () => { /* spawn */ });
  }, Math.min(1000 * 2 ** attempts, MAX_RESTART_BACKOFF)));
}

// Promise 串行化
#serialize(id: string, operation: () => Promise<void>): Promise<void> { /* ... */ }

// 健康检查只打日志
async #healthCheck(): Promise<void> {
  // ...
  if (!res.ok) this.#logger.warn("client health check failed", { id, status: res.status });
}
```

**问题**:

- exit、timer、health 三个来源没有统一状态；可能出现“已 stop 但 timer 仍 spawn”。
- `#restarts` / `#operations` / `#procs` / `#desired` / `#restartAttempts` 五张 Map 状态分散。
- 健康检查失败不重启，与 exit 行为不一致；进程假死无法恢复。
- `start`/`stop` 的串行化靠 per-id Promise，`stopAll` 与 `#scheduleRestart` 仍有竞争窗口。
- 没有 ClientManager 单测；任何改动都是高风险。

**目标**:

```ts
// gateway/src/client-manager/process-state.ts
export type ProcessState = "idle" | "starting" | "running" | "stopping" | "failed";

export type ProcessEvent =
  | { type: "start" }
  | { type: "spawned" }
  | { type: "ready" }
  | { type: "exit"; intentional: boolean }
  | { type: "stop" }
  | { type: "health_failed" }
  | { type: "reset" };

export function nextProcessState(state: ProcessState, event: ProcessEvent): ProcessState;
```

```ts
// gateway/src/client-manager/restart-policy.ts
export type RestartDecision =
  | { action: "restart"; attempt: number; delayMs: number }
  | { action: "give_up"; attempts: number };

export class RestartPolicy {
  next(): RestartDecision;
  reset(): void;
}
```

```ts
// gateway/src/client-manager/process-supervisor.ts
export type ProcessSupervisorDeps = {
  id: string;
  config: ClientConfig;
  port: number;
  logger: Logger;
  spawn: (spec: SpawnSpec) => ProcessHandle;
  probe: (url: string, timeoutMs: number) => Promise<boolean>;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => TimerHandle;
  clearTimer: (handle: TimerHandle) => void;
};

export class ProcessSupervisor {
  get state(): ProcessState;
  start(): Promise<void>;
  stop(): Promise<void>;
  checkHealth(): Promise<"healthy" | "unhealthy">;
}
```

**约束（外部行为）**:

- Gateway 路由 `/admin/clients`、`/gateway/inbound`、`/gateway/event`、鉴权、状态码、响应体不变。
- `ClientManager` 的 `startAll/stopAll/start/stop/list/getBySecret/getById` 签名不变。
- 端口分配规则 `clientPortRangeStart + index` 不变；secret 生成规则不变。
- 重启上限 5 次、退避 `1s * 2^attempt`、上限 30s、健康后 60s 重置次数不变。
- `stopAll` 的 `AggregateError` 语义不变。
- 健康检查失败现在进入同一重启策略（CR-ARCH-09 目标）；这是 Gateway 内部行为变化，需在发布说明中标注。
- 所有 timer 必须 `unref` 或可注入；`stopAll` 后不得再 spawn。

**验收**:

- 状态机单测覆盖 `idle → starting → running → stopping → idle` 与 `running → failed → starting`。
- 模拟 exit、健康失败、手动 stop 三者竞争，最终 `state === idle` 且无 timer。
- `start`/`stop` 并发调用串行化，`stop` 后不会复活。
- 现有 Gateway 测试全部通过；新增 ClientManager 测试使用 fake spawn/probe/timer，不启动真实子进程。

---

## 4. 目标契约汇总

### 4.1 ElementRegistry

见 CR-ARCH-01。核心不变量：

- 注册重复 → throw；解析缺失 → throw；错误文案保持。
- 注册顺序决定 `names()` 顺序；不排序、不去重。
- `clear()` 仅测试/重建使用；生产启动不调用。
- 一个 `startCore` 对应一个 registry；不同 registry 不共享状态。
- `PipelineManager` 只缓存 builder 闭包，不直接解析 Element；S11 不为它增加未使用的 registry 依赖。TaskEngine 通过 `PipelineInstanceStore` 与 builder 间接使用 registry。

### 4.2 PipelineInstanceStore

见 CR-ARCH-02。核心不变量：

- key 为 `taskId`；同一 taskId 覆盖写。
- `get` 未命中返回 `undefined`。
- 生命周期跟随 TaskEngine：成功/失败/取消/drain 后清理。
- 不做 TTL/容量限制（任务完成即删除；如未来需要，另开阶段）。

### 4.3 类型化 CoreServices

见 CR-ARCH-06。核心不变量：

- `CoreServices` 是**显式对象**，不是容器、不是字符串 token。
- `memory` / `network` 必填；`skill` / `compiler` 可选。
- `ServiceManager` 只负责启停，不进入 Core 业务代码。
- `main.ts` 是唯一同时知道具体服务类与 Core 契约的地方。

### 4.4 PromptRegistry

见 CR-ARCH-03。核心不变量：

- 每个 Core 实例一个 registry；创建时一次性注册语言/模型变体。
- `resolve` 的输出与当前实现逐字一致；缓存 key 不变。
- `PromptResolver` 是窄函数，不把整个 registry 传给每个 Element。
- 不再有模块级 `_instance`、懒初始化、`initPromptRegistry()`。

### 4.5 TaskEngine 单循环 / 不可变 FlowState

见 CR-ARCH-08。核心不变量：

- 单循环：同一时刻最多一个 task 在 `process`。
- 事件只负责唤醒，不负责调度。
- `start` 幂等；`stop` 不中断当前 task；`drain` 语义不变。
- FlowState 每次传给 Element 的都是新对象；不修改输入。
- 任务状态、事件顺序、取消链、错误码不变。

### 4.6 ProcessSupervisor

见 CR-ARCH-09。核心不变量：

- 每个 client 一个 supervisor；状态机是唯一状态来源。
- 所有 spawn/stop/restart 操作串行。
- 重启策略集中：上限、退避、成功重置。
- 健康检查与 exit 使用同一重启入口。
- `ClientManager` 只做 facade 与 secret/port 分配。

### 4.7 TUI ThemeContext

见 CR-ARCH-05。核心不变量：

- `ThemeContext` 只在 `tui-kit/src/theme.tsx` 定义。
- `tui` / `config-tui` 只从 `@atom-neo/tui-kit` 导入 `useTheme` / `ThemeProvider`。
- 不出现 `components/App.tsx` → component → `App.tsx` 的循环。

### 4.8 Element 边界窄接口

见 CR-ARCH-07。核心不变量：

- `PipelineSession` 只包含 Element 实际使用的成员；新增成员必须由真实调用驱动。
- `ElementTask` 直接复用 shared `TaskItem`，不复制字段。
- `SessionContext` 必须可结构化赋值给 `PipelineSession`。
- 不改变 `SessionContext` 的公开行为；只增加类型。
- 工具层/`pipeline-factory`/`stream-llm` 内部 `any` 不在本阶段范围。

---

## 5. 兼容性不变量

S11 完成后，以下行为必须与 `ef7ff15` 一致（除明确标注的 Gateway 内部健康重启）：

| 契约 | 不变量 | 验证 |
|---|---|---|
| HTTP 路由 | 路径、方法、优先级不变 | `http-router.test.ts` + 手工 |
| HTTP 状态码 | 200/201/400/403/404/409/500/503 不变 | 路由逐条 |
| attach | `sessionId` + `serverInfo` 字段不变 | attach 测试 |
| admin | header 名、token 比较、loopback 判定不变 | 403/200 |
| WS 路径 | `/ws/:sessionId` 不变 | upgrade 测试 |
| WS 消息 | `EVENTS` / `WsMessages` / envelope 不变 | 协议测试 |
| WS 顺序 | `session.ready` 先于任务事件 | WS 测试 |
| Task 提交 | `TaskSubmissionService` 去重/冲突不变 | task 测试 |
| Task 状态 | waiting/processing/completed/failed/cancelled 不变 | TaskEngine 测试 |
| Task 事件 | Activated/Completed/Failed/Committed 顺序不变 | lifecycle 测试 |
| Pipeline 顺序 | 5 条 pipeline 的元素名与顺序不变 | pipeline 快照/单测 |
| Prompt 输出 | 同一 key/provider/model 字符串一致 | prompt 快照 |
| 预算/检查点 | `task-lifecycle.ts` 回滚逻辑不变 | `task-lifecycle.test.ts` |
| 关闭顺序 | WS → timers → hooks/schedules → shell → drain → checkpoint → MCP → context → server | 关停测试 |
| Gateway 路由/鉴权 | 路径、状态码、secret/admin 不变 | gateway 测试 |
| Gateway 进程 | 端口/secret/重启上限/退避不变；健康失败新增重启 | 新 supervisor 测试 |
| Bun/Node | 两者均可构建/启动；新代码不用 Bun 专有 API | typecheck + Node smoke |
| 禁区 | 未实现 Element、Replay、PipelineRunner/Manager 不改 | diff 审查 |

---

## 6. 迁移与双读策略

S11 优先“先加新路径，再切调用，再删旧路径”：

| 对象 | 过渡方式 | 删除条件 |
|---|---|---|
| `ElementRegistry` | 保留模块级 legacy 实例和自由函数；新代码用实例 | 所有生产/测试调用迁移，`clearRegistry` 为 0 |
| `PromptRegistry` | 保留 `resolvePrompt` 旧导出；新代码注入 resolver | 所有生产调用迁移，prompt 测试改用 `createPromptRegistry` |
| `PipelineInstanceStore` | 保留 `api/tasks.ts` 旧函数委托到临时 store | TaskEngine 迁移完成，`pipelineMap` 为 0 |
| `CoreServices` | `startCore` 接受 `services`，过渡期可回退 `sm` | `main.ts` 与测试全部传 `services` |
| `TaskEngine` | 旧 reentry 代码保留到 D2 合并；D3 才抽 runner | D2/D3 测试通过后删除旧分支 |
| `ProcessSupervisor` | `ClientManager` 内部委托；外部签名不变 | E7 测试通过后删除旧 Map/回调 |
| Theme | 已迁移 | 只加防回归测试 |

**禁止**:

- 不做运行时 feature flag（除现有 `ATOM_HTTP_RUNTIME` 外）。
- 不双写 Task/Event/HTTP 响应。
- 不保留两套 TaskEngine 同时运行。
- 不为了过渡在构造函数里加“默认单例”（会重新引入全局）。

---

## 7. 验收标准（S11 整体）

- [ ] 同一进程内两个 `startCore` 实例（不同端口、不同 sandbox、不同 registry/prompt/store）可同时启动、提交任务、停止，互不污染。
- [ ] 两个 `PromptRegistry`、两个 `ElementRegistry`、两个 `PipelineInstanceStore` 的隔离测试通过。
- [ ] `rg 'clearRegistry|pipelineMap|getRegistry\\(|initPromptRegistry\\(' src --glob '!**/*.test.*'` 为 0。
- [ ] `core` 生产代码不再有 `sm.get`；缺失必填服务启动即失败。
- [ ] TaskEngine 串行、取消、drain、事件顺序测试通过；FlowState 输入不被变异。
- [ ] ClientManager 状态机、重启策略、健康检查、并发 start/stop 测试通过。
- [ ] `pipelines/**` 的 `session/task: any` 为 0；`SessionContext` 可直接赋值给 `PipelineSession`。
- [ ] Theme import 图无环；`useTheme` 只从 `tui-kit` 导入。
- [ ] `bun run typecheck` 6/6、`bun test` 全量 0 fail、`bun run build` 6/6。
- [ ] `bun run smoke:node` 与 `smoke:node:package` 通过（Node 26）。
- [ ] `bun run docs:check` / `bun run docs:typecheck` 通过。
- [ ] 每个任务单 commit 可回退；回滚不影响已发布 Bun/Node 行为。

---

## 8. 风险与假设

| 风险 | 影响 | 缓解 |
|---|---|---|
| 双实例测试暴露隐藏全局（env/cwd/时间） | 高 | H1 先做；所有新对象显式注入 sandbox/logger |
| Prompt 输出逐字变化 | 高 | 先拍快照；`createPromptRegistry` 不改注册顺序 |
| TaskEngine 单循环改变顺序 | 高 | D2 前先补顺序/取消/事件测试；保留 `TaskQueue` 规则 |
| FlowState 展开丢失非枚举字段 | 中 | 用对象展开而非 `Object.assign`；测试 Element 收到完整字段 |
| ProcessSupervisor 健康重启导致抖动 | 中 | 重启上限/退避不变；健康失败只在 running 且 desired 时触发 |
| 窄接口遗漏 Element 实际使用的方法 | 中 | 按 pipeline 分批迁移；`SessionContext` 结构化赋值编译验证 |
| 过渡包装被遗忘，重新变成全局 | 中 | H5 静态残留检查；DoD 明确删除条件 |
| S11 与 S12 文件冲突 | 中 | S11 不动巨型文件内部；S12 在 S11 后开始 |

**假设**:

- Node 26 / Bun 1.4 基线不变；不新增运行时依赖。
- `TaskQueue` 的优先级/顺序规则是产品契约，S11 不修改。
- Prompt 文本内容不属于 S11 变更；S11 只改所有权。
- Gateway 健康失败重启是 CR-ARCH-09 的目标行为，允许作为内部行为变化记录。
- 没有外部消费者直接 import `@atom-neo/core` 的 registry/pipelineMap/prompt 自由函数；若有，按过渡包装保留一个版本。

---

## 9. 验收命令

```bash
# 类型 / 测试 / 构建
bun run typecheck
bun test --path-ignore-patterns='**/dist/**'
bun test
bun run build
bun run typecheck:node

# Node smoke
bun run smoke:node
bun run smoke:node:package

# 文档
bun run docs:check
bun run docs:typecheck

# 残留检查（S11 完成后）
rg -n 'clearRegistry|pipelineMap|getRegistry\\(|initPromptRegistry\\(' src --glob '!**/*.test.*' --glob '!**/dist/**'
rg -n 'sm\\.get\\(' src/packages/core/src --glob '!**/*.test.*'
rg -n 'session\\??\\s*:\\s*any|task\\??\\s*:\\s*any' src/packages/core/src/pipelines --glob '!**/*.test.*'
rg -n 'from "\\.\\./App"|from "\\./App"' src/packages/tui/src --glob '!**/*.test.*'
```

---

## 10. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-11-12 | 初始 S11 专项审查：基于 `ef7ff15` 盘点 CR-ARCH-01..09，标注 04/05 已关闭；给出 ElementRegistry / PipelineInstanceStore / CoreServices / PromptRegistry / TaskEngine / ProcessSupervisor / PipelineSession 目标契约与兼容不变量；仅文档，未改源码 |
| 2026-11-12 | S11-B/C 实施：ElementRegistry 与 PipelineInstanceStore 已实例化并注入；CR-ARCH-01/02 关闭，旧全局 registry/自由函数与 `pipelineMap` 删除 |
