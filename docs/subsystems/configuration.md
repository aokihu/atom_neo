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

**配置读写入口**：

| 入口 | 写入层 | 时机 |
|------|--------|------|
| 手动编辑 config.json / .env | 用户配置（基线） | 随时 |
| `--config` 向导（`@atom-neo/config-tui`，OpenTUI 窗口化） | config.json（按 provider 合并）+ .env | 随时、交互式，详见 [first-run-wizard.md](./first-run-wizard.md) |
| 运行时 settings（TUI `/settings`） | `.atom/runtime-config.json`（overlay） | 运行中即时生效，见 §8 |
| `atom export` / `atom import`（或 `atom menu` → `backup`） | config.json + .env（归档迁移） | 备份、跨机器迁移，详见 [backup.md](./backup.md) |

---

## 2. config.json 完整结构

```jsonc
{
  "version": 2,

  // 模型档位：advanced/balanced/basic 为对话模型；fast 用于可选决策模型
  "providerProfiles": {
    "advanced": "deepseek/deepseek-v4-flash",
    "balanced": "deepseek/deepseek-v4-flash",
    "basic": "deepseek/deepseek-v4-pro",
    "fast": "openrouter-jev/typesafe/jev-1.13"
  },

  // LLM 供应商配置
  "providers": {
    "deepseek": {
      "type": "llm",
      "protocol": "deepseek",
      "apiKeyEnv": "DEEPSEEK_API_KEY",
      "models": ["deepseek-v4-flash", "deepseek-v4-pro"],
      "baseUrl": "https://api.deepseek.com/v1",
      "thinking": "disabled",
      "contextLimit": 131072
    },
    "openai": {
      "type": "llm",
      "protocol": "openai",
      "apiKeyEnv": "OPENAI_API_KEY",
      "models": ["gpt-4o", "gpt-4o-mini", "o4-mini"]
    },
    "volengine": {
      "type": "llm",
      "protocol": "openai-compatible",
      "apiKeyEnv": "VOLENGINE_API_KEY",
      "models": ["model-a"],
      "baseUrl": "https://api.volengine.example/v1"
    },
    "openrouter-jev": {
      "type": "jev",
      "apiKeyEnv": "OPENROUTER_API_KEY",
      "models": ["typesafe/jev-1.13"],
      "baseUrl": "https://openrouter.ai/api/alpha/decisions"
    }
  },

  "decisionMode": { "prediction": "jev", "postConversation": "jev", "continuation": "jev" },

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

**Jev 设置**: `type` 缺省为 `llm`；`fast` 缺省回退到 `basic`。Jev 的 `baseUrl` 填完整 Decisions 端点，代码不提供默认请求地址；缺少地址时由 basic LLM 模拟。Key 放在 `.env`。两条管道的 `decisionMode` 可独立设为 `legacy` 或 `jev`，缺省 `legacy`；详见 [jev-decisions.md](./jev-decisions.md)。

**Provider 协议**: `protocol` 可选，支持 `deepseek`、`openai`、`anthropic`、`openai-compatible`：
- 显式 `providers[id].protocol` 优先；
- 未填写时按 provider id 推断：`deepseek` / `openai` / `anthropic` 使用同名协议；
- 其他 id 默认 `openai-compatible`（适合自建或第三方兼容 OpenAI 的服务）；
- `openai-compatible` 必须配置 `baseUrl`，缺失时构造模型会明确报错；
- `type: "jev"` 的决策端点不使用 `protocol`，继续走 JEV 客户端。

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

配置契约（Schema、默认值、Provider/TUI 主题清单）的**唯一来源**是
`src/packages/shared/src/config/`，通过 `@atom-neo/shared` 导出：

| 文件 | 内容 |
|------|------|
| `config/schema.ts` | `ConfigSchema`、`RuntimeConfigSchema`、`mergeConfig`、`overlaySchema` |
| `config/providers.ts` | `ProviderProfilesSchema`、`ProviderDefinitionSchema`、`PROVIDER_PROTOCOLS`、`inferProviderProtocol`、`PROVIDERS`、`DEFAULT_PROFILES`、`DEFAULT_DECISION_MODES` |
| `config/client.ts` | `ClientConfigSchema`（Core 配置与 Gateway 共用的 client 条目） |
| `config/theme.ts` | `THEME_NAMES`、`ThemeName`、`DEFAULT_THEME` |

`src/bootstrap/config.ts` 只负责文件加载/保存，并 re-export 上述类型与函数；`config-tui` 与
`gateway` 直接依赖 shared，不再维护副本。

```typescript
// src/packages/shared/src/config/schema.ts（节选）
const ConfigSchema = z.object({
  version: z.literal(2).default(2),
  providerProfiles: ProviderProfilesSchema.default({ ...DEFAULT_PROFILES }),
  providers: z.record(z.string(), ProviderDefinitionSchema).default({}),
  transport: z.object({ maxOutputTokens: z.number().int().default(4096) }).default({ maxOutputTokens: 4096 }),
  gateway: z.object({ port: z.number().int().default(3000), clients: z.array(ClientConfigSchema).default([]) }).default({ port: 3000, clients: [] }),
  tui: z.object({ theme: z.enum(THEME_NAMES).default(DEFAULT_THEME) }).default({ theme: DEFAULT_THEME }),
});

export type AppConfig = z.infer<typeof ConfigSchema>;
```

> 顶层 `theme` 字段已废弃：主题只读取 `tui.theme`，旧文件中的顶层 `theme` 会被忽略。

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
            → inferProviderProtocol("deepseek", providerConfig) → "deepseek"

RuntimeService.getResolvedModel("balanced") → {
  provider: "deepseek",
  protocol: "deepseek",                     // explicit or inferred
  model: "deepseek-v4-flash",
  type: "llm",                              // "llm" | "jev"
  apiKey: "sk-xxx",
  baseUrl: "https://api.deepseek.com/v1",  // optional
  thinking: "disabled",                     // "enabled" | "disabled" | "adaptive"
  options: { ... },                         // optional raw providerOptions
}

// server.ts / AgentsCompiler 统一走工厂与 provider options 策略
const model = createLanguageModel(resolved);
const providerOptions = providerOptionsFor(resolved);
// → providerOptions 透传至对应 SDK 调用
```

**Provider 处理逻辑**（`createLanguageModel`）：
- `deepseek` → `createDeepSeek`
- `openai` → `createOpenAI`
- `anthropic` → `createAnthropic`
- `openai-compatible` → `createOpenAICompatible`（必须有 `baseUrl`）

**Provider options 策略**（`providerOptionsFor`）：
- `deepseek` → `{ deepseek: { thinking: { type } } }`（保持原有行为）
- `anthropic` → `thinking` 为 `enabled` / `adaptive` 时发送 `{ anthropic: { thinking: { type: "enabled", budgetTokens: 2048 } } }`，否则不发送
- `openai` / `openai-compatible` → 默认不发送；如需要请显式配置 `providers[id].options`
- `providers[id].options` 存在时视为已塑形的原始 `providerOptions`，直接透传

**API Key 获取规则**：
1. 只读取 `providers[provider].apiKeyEnv` 指向的环境变量；
2. 变量缺失或为空时返回空字符串，调用方按无密钥处理；
3. **不再回退**到 `DEEPSEEK_API_KEY` / `OPENAI_API_KEY` 等其他 Provider 的密钥（CR-PRO-06）。

---

## 6. 默认 config（config.json 不存在时）

```typescript
// 最小可执行默认值
{
  version: 2,
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
- `"adaptive"` — 兼容旧配置；当前 DeepSeek SDK 会将其映射为 `enabled`
- `"enabled"` — 强制启用思考模式

运行时覆盖写入后，下一次创建的对话、预测、摘要、对话后分析及 LLM 决策回退请求都从有效配置读取所用 provider 的 thinking 值，并发送 `thinking.type`。已在执行中的请求继续使用创建时的配置。手动编辑 `config.json` 仍需重启 Core 才会重新载入。

**TUI 展示**：`thinking` 状态会通过 `ServerInfo` 传递给 TUI，在 `StatusBar` 组件中于模型名称右侧显示 `[thinking]` 标签。颜色含义：
- 高亮（`status.success`） — `enabled`，或兼容值 `adaptive`（实际映射为启用）
- 灰色（`text.muted`） — `disabled`（已关闭）

**`edex` 主题（默认）**：使用近黑背景、淡青色边框与分段标题。它只改变颜色，
TUI 的 Runtime / Conversation / Telemetry 响应式布局对所有主题生效。

**架构说明**：`config.json` 中 `thinking` 的值由 `providerOptionsFor()` 按 `protocol` 翻译为对应 AI SDK 的 `providerOptions`。对话主链的 `StreamLLMElement` 不感知 provider 具体选项结构，仅负责将 `server.ts` 计算好的 `providerOptions` 原样注入 `streamText()`；预测、后处理、摘要与决策回退在各自入口调用同一 helper。

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
// RuntimeService (src/services/runtime/runtime-service.ts)
const runtime = sm.get("runtime");

runtime.maxTokens;    // transport.maxOutputTokens
runtime.appConfig;    // 有效配置对象（userConfig + runtimeOverlay 合并结果）

const m = runtime.getResolvedModel("balanced");
// → { provider, protocol, model, type, apiKey, baseUrl?, thinking?, options? }

const model = createLanguageModel(m);          // @atom-neo/core
const providerOptions = providerOptionsFor(m); // @atom-neo/core

// 运行时调整（仅 TUI 经 API 调用，见 §8）
runtime.updateRuntimeConfig({ providerProfiles: { balanced: "deepseek/deepseek-v4-pro" } });
runtime.resetRuntimeConfig();
```

`getResolvedModel()` 动态读取有效配置 —— 模型档位切换后下一轮任务即生效，无需重启。

---

## 8. 运行时调整 API（仅 TUI）

**访问控制**：默认使用随机 admin token，仅接受 loopback 且携带正确 `x-atom-admin-token` 的管理请求。显式设置 `ATOM_ADMIN_TOKEN` 后 Core 使用该固定 Token，并允许正确鉴权的远程 TUI 管理请求，详见 [启动向导](startup-menu.md)。该环境变量不转发给 Gateway 平台 Client 或 shell 工具子进程；Gateway 自身管理端点仍仅限 loopback。

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

密钥绝不写入 config.json。config.json 中的 `apiKeyEnv` 字段声明读取哪个环境变量。每个 Provider 只读取自己的 `apiKeyEnv`；不同 Provider 之间不共享或回退密钥。

## 相关文档

| 文档 | 说明 |
|------|------|
| [bootstrap.md](../overview/bootstrap.md) | 配置自动创建流程 |
| [sandbox.md](./sandbox.md) | 沙箱目录中的 config.json 位置 |
| [architecture.md](../overview/architecture.md) | 配置在系统架构中的角色 |

**续写仲裁**：`decisionMode.continuation` 缺省 `jev`，仅冲突时调用 `fast`；设置 `rules` 关闭模型仲裁，仍使用统一规则和进度核对。复用 `basic` 模拟回退；不修改输出 token 上限。

## 双层执行预算（2026-10-09）

conversation.maxGlobalRounds 默认100（正整数）；maxLocalRounds 默认5，允许5～10。显式旧 maxChainDepth 按后续轮次换算为全局额度 maxChainDepth+1，新字段优先；不改写用户文件。目标预算独立于 Topic，明确新目标建立新记录；同目标恢复、核对、Post 重试及压缩通过统一入队检查，不重置全局累计。

释放前先保存正文/进度，再保存预算扣减；尚未释放的暂存不计数，保存失败不入队。窗口健康检查优先 JEV，失败后 LLM 模拟一次（分别10秒、512 tokens、零重试）；healthy 只重置局部，不健康或 unknown 保留待执行请求并暂停。精确“继续”/continue 跳过 Prediction，全局暂停追加额度，其他暂停重查原窗口。完整任务载荷和续写参数持久化并在压缩后保留。

详见 [健康检查](../pipelines/follow-up-evaluator.md)。

旧版运行时配置补丁若仅发送 maxChainDepth，也换算为 maxGlobalRounds=depth+1；同一补丁显式提供新字段时以新字段为准。
