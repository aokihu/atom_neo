# Configuration System

> **Purpose**: 配置加载优先级、格式、自动创建和双层运行时调整机制。

---

## 1. 双层配置架构

配置分为两层：**用户配置**（基线）与**运行时配置**（增量覆盖）。

```text
$SANDBOX/config.json                  用户配置（基线）
  └─ 由 config-tui 向导 / 手动编辑写入
  └─ 运行时永不修改此文件

$SANDBOX/.atom/runtime-config.json    运行时配置（overlay）
  └─ 仅记录运行中被调整过的字段
  └─ 只能通过 TUI 设置界面修改（admin token 鉴权）

有效配置 = deepMerge(config.json, runtime-config.json)
  └─ 系统运行全程只读「有效配置」
  └─ 对象递归合并、数组整体替换、overlay 优先
```

**设计要点**：

- 用户在 TUI 中切换模型档位、主题等 → 只写入 `runtime-config.json`，`config.json` 保持不变
- 重启后 overlay 仍然生效（持久化）；删除 overlay 文件或调用 reset 端点即恢复纯用户配置
- `config.json` 后续手动修改不会失效 —— overlay 只覆盖被改过的字段
- **禁止运行时覆盖的字段**：`gateway` 子树（端口/客户端需重启才生效）；密钥本就只存于 `.env`（见 §7）

**三个配置修改入口**：

| 入口 | 写入层 | 时机 |
|------|--------|------|
| 手动编辑 config.json / .env | 用户配置（基线） | 随时 |
| `--config` 向导（`@atom-neo/config-tui`，OpenTUI 窗口化） | config.json（按 provider 合并）+ .env | 随时、交互式，详见 [first-run-wizard.md](./first-run-wizard.md) |
| 运行时 settings（TUI `/settings`） | `.atom/runtime-config.json`（overlay） | 运行中即时生效，见 §8 |

---

## 2. config.json 完整结构

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

**无效 provider 恢复**: 若 config.json 中某个 `providers[x]` 条目校验失败（如缺 `apiKeyEnv` 或 `models` 为空），`loadConfig` 会丢弃该条目并保留其余配置，而不是整体回退默认值。这保证单个损坏条目不会让 gateway/mcpServers 等配置全部失效。

---

## 3. 配置优先级

```text
CLI args (--port, --host, --sandbox)  >  runtime-config.json  >  config.json  >  默认值
```

- CLI 只覆盖启动参数（port/host/sandbox/mode），不覆盖 config.json 内部字段
- `runtime-config.json` 覆盖 `config.json` 的同名字段（深合并，见 §1）
- `.env` 用于存储 `DEEPSEEK_API_KEY` 等密钥，不参与 config 合并
- `config.json` 不存在时，回退到默认值（deepseek/deepseek-v4-flash）

---

## 4. Schema 定义

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
  gateway: z.object({ port: z.number().int().default(3000) }).default({...}),
  tui: z.object({ theme: z.enum(["edex", "github-dark", "github-light", "dracula", "nord", "tokyo-night", "solarized-dark", "monokai"]).default("edex") }).default({...}),
});

export type AppConfig = z.infer<typeof ConfigSchema>;
```

---

## 5. 模型解析流程

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

## 6. 默认 config（config.json 不存在时）

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
  gateway: { port: 3000 },
  tui: { theme: "edex" },
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

**`edex` 主题（默认）**：使用近黑背景、淡青色边框与分段标题。它只改变颜色，
TUI 的 Runtime / Conversation / Telemetry 响应式布局对所有主题生效。

**架构说明**：`config.json` 中 `thinking` 的值由 `server.ts` 翻译为 AI SDK 的 `providerOptions` 对象，再透传给 `StreamLLMElement`。Element 不感知 provider 具体选项结构，仅负责将 `providerOptions` 原样注入 `streamText()`。未来扩展其他 provider（OpenAI `reasoningEffort`、Gemini `thinkingConfig`）时只需修改 `server.ts` 的翻译逻辑，无需改动 Element 代码。

**`contextLimit` 字段**：
- 可选，指定模型的最大上下文 Token 数量
- 最高优先级：`providers[provider].contextLimit`（用户显式覆盖）
- 次优先级：内置 `CONTEXT_LIMITS` 表（`src/packages/core/src/constants.ts`）
- 均无时默认 `131,072` (128K)
- 用于计算当前 `Context Tokens` 的百分比：
  ```
  Total: 12,480 / 1,000,000 (1.25%)
  ```

---

## 7. 运行时访问与调整

```typescript
// RuntimeService (src/services/runtime-service.ts)
const runtime = sm.get("runtime");

// 旧式访问（保留兼容）
runtime.apiKey;       // 全局 apiKey（fallback）
runtime.maxTokens;    // transport.maxOutputTokens
runtime.appConfig;    // 有效配置对象（userConfig + runtimeOverlay 合并结果）

// 新式访问
const m = runtime.getResolvedModel("balanced");
// → { provider: "deepseek", model: "deepseek-v4-flash", apiKey: "sk-xxx" }

// 运行时调整（仅 TUI 经 API 调用，见 §8）
runtime.updateRuntimeConfig({ providerProfiles: { balanced: "deepseek/deepseek-v4-pro" } });
runtime.resetRuntimeConfig();
```

`getResolvedModel()` 动态读取有效配置 —— 模型档位切换后下一轮任务即生效，无需重启。

---

## 8. 运行时调整 API（仅 TUI）

**访问控制**：main.ts 启动时生成随机 admin token，仅注入 TUI。请求必须来自 loopback 且携带 `x-atom-admin-token` 头，否则一律 403。Gateway 与外部 client 无 token，天然被拒。

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/config` | GET | 返回有效配置（合并后） |
| `/api/config/runtime` | PATCH | 校验并合并 patch 到 overlay，持久化，返回有效配置 |
| `/api/config/runtime` | DELETE | 清空 overlay，恢复纯用户配置 |

**PATCH 校验规则**：

- body 必须通过 `RuntimeConfigSchema`（`ConfigSchema` 的递归 partial）
- `gateway` 子树被 `strict()` 拒绝 —— 返回 400
- 数组字段整体替换（如 `mcpServers`、`providers.*.models`）

---

## 9. 密钥管理

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
