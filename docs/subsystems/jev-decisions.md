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

Post 与 continuation 的跟踪参数实验复用本调用模块，最终保留限定选项 contentState、reasonCode、evidenceRef，续写增加 intentScope。reasonCode 只用于诊断，不能另行否决专门的内容/范围判断。Runtime 校验 status/behavior/contentState 的完成一致性；缺少证据标记 unknown，不将裁剪内容推断为缺少交付。删除字数、长度解析、相似度及续写统计计算。实验见 [progress-evidence-experiment.md](../pipelines/progress-evidence-experiment.md)。

- Prediction 继续原样使用当前 User 文本和上一轮有界参考。Jev 选择固定的难度、模型档位、意图、上下文关系，以及 Topic 的 category、domain、specific 三组候选。代码按各组选项概率给注册表中的完整 Topic 排序，只输出合法的 `<category>.<domain>.<specific>` 组合；跟进请求仍由 finalize 继承当前 Topic。注册表包含 `other` 选项。
- Post-Conversation 继续使用现有输入摘要。Jev 选择三态质量和固定行为类别；代码将类别转换为旧 finalize 能消费的 `fingerprint`，不要求 Jev 生成文本。
- 两条管道沿用原有 source、boundary、sink。Jev 无效答案、无凭据或调用失败不得阻塞对话，也不得凭不确定结果自动重试。

## 验收顺序

1. 独立调用模块的本地模拟 HTTP 测试通过。
2. `JevElement` 的两种用途及 LLM 模拟路径通过测试，原 Element 测试继续通过。
3. 配置解析、两个模式开关和缺失凭据回退通过测试。
4. 项目类型检查、构建和测试通过；配置真实 Key 后再执行一次 OpenRouter 端到端验收。

配置向导保存时保留手工设置的 `fast`、`type` 和 `decisionMode`；运行时 Settings 可选择 `fast`，其余三个模型档位只列出 LLM。运行时 overlay 调整对后续任务生效；手工修改 `config.json` 后需要重启 Core。

## Continuation 仲裁

改写现有 check-follow-up，不增加 Element。decisionMode.continuation 为 jev（默认）或 rules；
rules 关闭模型判断，保留新规则仲裁。仅冲突/不确定情况调用 fast 模型，无 Jev 配置时复用
LLM 限定选择模拟。一次调用上限 10 秒，模拟输出上限 512 tokens，不自动重试，支持取消。
选择 resume_current / advance_todo / reconcile_progress / finish；Runtime 再校验合法性。
失败保留未完成状态并核对。输入包含用户目标、前后 TODO、当前项、结束原因、intent、
正文首尾和相关历史；裁剪证据明确标记。不得仅凭正文声明完成任务，不静默修改 TODO。
复用独立 callJev 和模拟调用；日志保留概率/置信度但不设未校准阈值。
验证后直接接管，无旁路观察模式。


## 调试请求捕获

`chooseDecision` 提供可选的请求观察回调，在实际模型选择后、调用之前提供 source、model、state、questions，以及 LLM 的 token/retry 限制。调用方以 `decision-request` 写入已有 debug 日志并附任务标识；没有可用模型时不产生该事件，失败/取消仍走既有路径。该事件表示已准备调用，不能单独证明服务端收到请求；应结合后续结果或失败记录判断。回调观察同一请求内容，不记录 apiKey、endpoint 或 Authorization，也不修改传给模型的内容。

Continuation 和现有 JevElement（Prediction、Post）共享该记录点；规则直接决定的分支不产生 decision-request。原始 choices 和最终 Runtime 决定通过 taskId 关联。请求中的业务摘录可能含用户内容，日志仅供本机诊断。

## 双层执行预算（2026-10-09）

conversation.maxGlobalRounds 默认100（正整数）；maxLocalRounds 默认5，允许5～10。显式旧 maxChainDepth 按后续轮次换算为全局额度 maxChainDepth+1，新字段优先；不改写用户文件。目标预算独立于 Topic，明确新目标建立新记录；同目标恢复、核对、Post 重试及压缩通过统一入队检查，不重置全局累计。

释放前先保存正文/进度，再保存预算扣减；尚未释放的暂存不计数，保存失败不入队。窗口健康检查优先 JEV，失败后 LLM 模拟一次（分别10秒、512 tokens、零重试）；healthy 只重置局部，不健康或 unknown 保留待执行请求并暂停。精确“继续”/continue 跳过 Prediction，全局暂停追加额度，其他暂停重查原窗口。完整任务载荷和续写参数持久化并在压缩后保留。

详见 [健康检查](../pipelines/follow-up-evaluator.md)。

预算健康检查诊断分别记录实际模型请求和提供方返回的 token usage；usage 缺失保持 unknown，不根据轮次数推算 tokens。续写的 rules 模式只关闭续写语义仲裁，局部窗口治理仍需要健康判断。
