# Configuration System

> **Purpose**: 配置加载优先级、格式、自动创建和热重载机制。

---

## 1. config.json 完整结构

```jsonc
{
  "version": 2,
  "theme": "dark",

  // 模型档位：advanced/balanced/basic，格式 "provider/model"
  "providerProfiles": {
    "advanced": "deepseek/deepseek-v4-flash",
    "balanced": "deepseek/deepseek-v4-flash",
    "basic": "deepseek/deepseek-v4-pro"
  },

  // LLM 供应商配置
  "providers": {
    "deepseek": {
      "apiKeyEnv": "DEEPSEEK_API_KEY",
      "models": ["deepseek-v4-flash", "deepseek-v4-pro"],
      "baseUrl": "https://api.deepseek.com/v1",
      "thinking": "disabled",
      "contextLimit": 131072
    }
  },

  "transport": {
    "maxOutputTokens": 4096
  },

  "gateway": {
    "jwtSecret": "change-me-minimum-16-chars",
    "port": 3000
  },

  "tui": {
    "theme": "dracula"
  },

  "permission": {
    "whitelist": ["$HOME/Projects", "$SANDBOX/../shared", "/tmp/build"]
  }
}
```

**自动创建**: bootstrap 启动时若 `$SANDBOX/config.json` 不存在，自动写入上述最小可用配置。解析失败（格式错误）时只返回默认值，不覆盖文件。

---

## 2. 配置优先级

```text
CLI args (--port, --host, --sandbox)  >  config.json  >  默认值
```

- CLI 只覆盖启动参数（port/host/sandbox/mode），不覆盖 config.json 内部字段
- `.env` 用于存储 `DEEPSEEK_API_KEY` 等密钥，不参与 config 合并
- `config.json` 不存在时，回退到默认值（deepseek/deepseek-v4-flash）

---

## 3. Schema 定义

```typescript
// src/bootstrap/config.ts
const ProviderProfilesSchema = z.object({
  advanced: z.string().default("deepseek/deepseek-v4-flash"),
  balanced: z.string().default("deepseek/deepseek-v4-flash"),
  basic: z.string().default("deepseek/deepseek-v4-flash"),
});

const ProviderDefinitionSchema = z.object({
  apiKeyEnv: z.string(),
  models: z.array(z.string()).min(1),
  baseUrl: z.string().optional(),
  options: z.record(z.unknown()).optional(),
  thinking: z.enum(["enabled", "disabled", "adaptive"]).default("disabled"),
  contextLimit: z.number().int().positive().optional(),
});

const ConfigSchema = z.object({
  version: z.literal(2).default(2),
  theme: z.string().default("dark"),
  providerProfiles: ProviderProfilesSchema.default({...}),
  providers: z.record(z.string(), ProviderDefinitionSchema).default({}),
  transport: z.object({ maxOutputTokens: z.number().int().default(4096) }).default({...}),
  gateway: z.object({ jwtSecret: z.string(), port: z.number().int().default(3000) }).default({...}),
  tui: z.object({ theme: z.enum(["github-dark", "github-light", "dracula", "nord", "tokyo-night", "solarized-dark", "monokai"]).default("github-dark") }).default({...}),
});

export type AppConfig = z.infer<typeof ConfigSchema>;
```

---

## 4. 模型解析流程

```
config.json
  └─ providerProfiles.balanced = "deepseek/deepseek-v4-flash"
       │
       ├─ provider = "deepseek"
       ├─ model   = "deepseek-v4-flash"
       └─ → providers["deepseek"].apiKeyEnv = "DEEPSEEK_API_KEY"
            → process.env.DEEPSEEK_API_KEY → apiKey
            → providers["deepseek"].baseUrl → baseUrl (optional)

RuntimeService.getResolvedModel("balanced") → {
  provider: "deepseek",
  model: "deepseek-v4-flash",
  apiKey: "sk-xxx",
  baseUrl: "https://api.deepseek.com/v1",  // optional
  thinking: "disabled",                     // "enabled" | "disabled" | "adaptive"
}

// server.ts 将 thinking 翻译为 AI SDK providerOptions
const providerOptions = {
  deepseek: { thinking: { type: resolved.thinking ?? "disabled" } },
};
// → 透传至 StreamLLMElement，直接注入 streamText()
```

**Provider 处理逻辑**：
- `deepseek` → `createDeepSeek({ apiKey, baseURL })`  — 使用 `@ai-sdk/deepseek`
- `openai` / `openaiCompatible` → 同样使用 `createDeepSeek({ apiKey, baseURL })`  — DeepSeek SDK 兼容 OpenAI 协议

**API Key 获取优先级**：
1. `providers[provider].apiKeyEnv` 环境变量
2. 回退到 `DEEPSEEK_API_KEY` 或 `OPENAI_API_KEY`（全局 fallback）

---

## 5. 默认 config（config.json 不存在时）

```typescript
// 最小可执行默认值
{
  version: 2,
  theme: "dark",
  providerProfiles: {
    advanced: "deepseek/deepseek-v4-flash",
    balanced: "deepseek/deepseek-v4-flash",
    basic: "deepseek/deepseek-v4-flash",
  },
  providers: {},
  transport: { maxOutputTokens: 4096 },
  gateway: { jwtSecret: "change-me-minimum-16-chars", port: 3000 },
  tui: { theme: "github-dark" },
}
```

**`thinking` 字段说明**：
- `"disabled"` — 禁用思考模式（默认），避免 `reasoning_content` 回传错误
- `"adaptive"` — 模型自行决定是否启用思考
- `"enabled"` — 强制启用思考模式

**TUI 展示**：`thinking` 状态会通过 `ServerInfo` 传递给 TUI，在 `StatusBar` 组件中于模型名称右侧显示 `[thinking]` 标签。颜色含义：
- 绿色（`status.success`） — `enabled`（强制启用）
- 黄色（`status.warning`） — `adaptive`（模型自适应）
- 灰色（`text.muted`） — `disabled`（已关闭）

**架构说明**：`config.json` 中 `thinking` 的值由 `server.ts` 翻译为 AI SDK 的 `providerOptions` 对象，再透传给 `StreamLLMElement`。Element 不感知 provider 具体选项结构，仅负责将 `providerOptions` 原样注入 `streamText()`。未来扩展其他 provider（OpenAI `reasoningEffort`、Gemini `thinkingConfig`）时只需修改 `server.ts` 的翻译逻辑，无需改动 Element 代码。

**`contextLimit` 字段**：
- 可选，指定模型的最大上下文 Token 数量
- 最高优先级：`providers[provider].contextLimit`（用户显式覆盖）
- 次优先级：内置 `CONTEXT_LIMITS` 表（`src/packages/core/src/constants.ts`）
- 均无时默认 `131,072` (128K)
- 用于计算 `Session Token Usage` 中的百分比：
  ```
  Total: 12,480 / 1,000,000 (1.25%)
  ```

---

## 6. 运行时访问

```typescript
// RuntimeService (src/services/runtime-service.ts)
const runtime = sm.get("runtime");

// 旧式访问（保留兼容）
runtime.apiKey;       // 全局 apiKey（fallback）
runtime.maxTokens;    // transport.maxOutputTokens
runtime.appConfig;    // 完整配置对象

// 新式访问
const m = runtime.getResolvedModel("balanced");
// → { provider: "deepseek", model: "deepseek-v4-flash", apiKey: "sk-xxx" }
```

---

## 7. 密钥管理

```text
.sandbox/.env (gitignored):
DEEPSEEK_API_KEY=sk-xxx
OPENAI_API_KEY=sk-xxx
```

密钥绝不写入 config.json。config.json 中的 `apiKeyEnv` 字段声明读取哪个环境变量。

## 相关文档

| 文档 | 说明 |
|------|------|
| [bootstrap.md](../overview/bootstrap.md) | 配置自动创建流程 |
| [sandbox.md](./sandbox.md) | 沙箱目录中的 config.json 位置 |
| [architecture.md](../overview/architecture.md) | 配置在系统架构中的角色 |