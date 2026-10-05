# Jev Decisions

> **Purpose**: 在不依赖 AI SDK 的调用模块中访问结构化决策模型，并让 Prediction 与 Post-Conversation 可独立切回现有 LLM Element。

## 独立调用模块

`src/packages/core/src/decision/jev-client.ts` 只负责向调用方传入的完整决策端点发送 `{ model, state, questions }`，携带 Bearer API Key 和 AbortSignal，校验 HTTP 状态及 `answers` 中每个问题的类型、选项和概率。它不构造 Prompt，也不调用 `generateText`，且不内置任何平台地址。OpenRouter 示例使用 `POST https://openrouter.ai/api/alpha/decisions`；使用相同决策协议的模型可设置自己的端点。

先用注入的 HTTP 函数测试请求、响应、失败和取消，再把模块接入 Element。没有 OpenRouter Key 时，测试不发送真实请求。

## 配置与回退

```jsonc
{
  "providerProfiles": {
    "advanced": "deepseek/deepseek-v4-flash",
    "balanced": "deepseek/deepseek-v4-flash",
    "basic": "deepseek/deepseek-v4-flash",
    "fast": "openrouter-jev/typesafe/jev-1.13"
  },
  "providers": {
    "deepseek": { "type": "llm", "apiKeyEnv": "DEEPSEEK_API_KEY", "models": ["deepseek-v4-flash"] },
    "openrouter-jev": {
      "type": "jev",
      "apiKeyEnv": "OPENROUTER_API_KEY",
      "models": ["typesafe/jev-1.13"],
      "baseUrl": "https://openrouter.ai/api/alpha/decisions"
    }
  },
  "decisionMode": { "prediction": "jev", "postConversation": "jev" }
}
```

`OPENROUTER_API_KEY` 写在沙箱 `.env` 中，绝不写入 `config.json`。`type: "jev"` 的 `baseUrl` 是**完整决策端点**，由 provider 配置提供；缺少地址时不会发送 Jev 请求，而是使用 basic LLM 模拟。OpenRouter 的 `https://openrouter.ai/api/v1` 是聊天 API 地址，不用于 Jev。Provider 类型缺省为 `llm`，保持旧配置有效。同一平台若同时配置 LLM 与 Jev，使用两个 provider ID。

`decisionMode` 的两个字段独立，缺省为 `legacy`。`legacy` 使用原来的 `predict-intent` 或 `post-analyze-result`；`jev` 让新 `JevElement` 处理判断。新 Element 在 `fast` 指向 `llm`、未配置 Jev 或 Jev 凭据不可用时，使用 AI SDK 和专用提示词模拟相同的限定选择。切回 `legacy` 不需要修改原 Element。

## 判断边界

- Prediction 继续原样使用当前 User 文本和上一轮有界参考。Jev 选择固定的难度、模型档位、意图、上下文关系，以及 Topic 的 category、domain、specific 三组候选。代码按各组选项概率给注册表中的完整 Topic 排序，只输出合法的 `<category>.<domain>.<specific>` 组合；跟进请求仍由 finalize 继承当前 Topic。注册表包含 `other` 选项。
- Post-Conversation 继续使用现有输入摘要。Jev 选择三态质量和固定行为类别；代码将类别转换为旧 finalize 能消费的 `fingerprint`，不要求 Jev 生成文本。
- 两条管道沿用原有 source、boundary、sink。Jev 无效答案、无凭据或调用失败不得阻塞对话，也不得凭不确定结果自动重试。

## 验收顺序

1. 独立调用模块的本地模拟 HTTP 测试通过。
2. `JevElement` 的两种用途及 LLM 模拟路径通过测试，原 Element 测试继续通过。
3. 配置解析、两个模式开关和缺失凭据回退通过测试。
4. 项目类型检查、构建和测试通过；配置真实 Key 后再执行一次 OpenRouter 端到端验收。

配置向导保存时保留手工设置的 `fast`、`type` 和 `decisionMode`；运行时 Settings 可选择 `fast`，其余三个模型档位只列出 LLM。运行时 overlay 调整对后续任务生效；手工修改 `config.json` 后需要重启 Core。
