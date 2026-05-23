# P2: appConfig 接入 — 实施方案

## 目标

`loadConfig()` 的结果当前已加载但未被使用（dead code）。将其接入 RuntimeService，让 transport config（maxOutputTokens、model）在 LLM 调用时生效。

## 当前状态

```typescript
// main.ts — appConfig 已加载但未传递
const appConfig = loadConfig(args.sandbox);  // 返回值未使用
```

```typescript
// server.ts — maxTokens/model 硬编码
const result = await generateText({
  model, messages: messages as any,
  tools: ..., maxSteps: 5, maxTokens: 1024,  // 硬编码
});
```

## 改造方案

### 1. RuntimeService 增加 appConfig

```typescript
// runtime-service.ts
import type { AppConfig } from "../bootstrap/config";

export class RuntimeService extends BaseService {
  #appConfig?: AppConfig;

  constructor(params: RuntimeParams & { appConfig?: AppConfig }) {
    // ...
    this.#appConfig = params.appConfig;
  }

  get appConfig(): AppConfig | undefined { return this.#appConfig; }
}
```

### 2. main.ts — 传入 appConfig

```typescript
const appConfig = loadConfig(args.sandbox);
const runtime = new RuntimeService({
  mode, port, host, sandbox, apiKey,
  appConfig,  // ← 传入
});
```

### 3. server.ts — 从 runtime 读取

```typescript
const maxTokens = runtime?.appConfig?.transport?.maxOutputTokens ?? 1024;

const result = await generateText({
  model, messages,
  tools, maxSteps: 5,
  maxTokens,  // ← 从 config 读取
});
```

### 4. 改动范围

| 文件 | 改动 |
|------|------|
| `src/services/runtime-service.ts` | 增加 `appConfig` getter + 构造参数 |
| `src/services/types.ts` | `RuntimeParams` 增加 `appConfig?: AppConfig` |
| `src/main.ts` | 传入 `appConfig` 到 RuntimeService 构造 |
| `src/packages/core/src/server.ts` | `maxTokens` 从 `runtime.appConfig` 读取 |
| `src/packages/core/src/pipelines/conversation/elements/index.ts` | StreamLLMElement 接受 `maxTokens` 参数 |

### 5. 风险

- `appConfig` 可选（config.json 可能不存在），默认值 1024 保持兼容
- `transport.model` 配置当前已有生效（通过 `RuntimeService.apiKey` + server 硬编码的 `"deepseek-chat"`），后续可扩展为从 config 读取 model 选择
