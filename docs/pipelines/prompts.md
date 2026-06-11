# Prompt Registry — 提示词统一管理

> **Purpose**: 所有 LLM 提示词集中管理 — 多语言、模型级精细化追加、惰性合成缓存。

## 职责

所有 LLM 提示词集中管理、多语言支持、模型级精细化调优、惰性合成缓存。

## 问题

```
之前: 14+ 处内嵌提示词字符串散落在 9 个 pipeline element 文件中
    ├─ 混用中英文，无切换机制
    ├─ 修改提示词需搜遍全项目
    ├─ 无法针对不同模型/语言优化
    └─ 每次请求重复计算相同内容
```

## 架构

```
src/packages/shared/src/prompts/
  index.ts              — resolvePrompt(key, provider, model): string
  registry.ts           — PromptRegistry: 惰性合成 + Map 缓存
  keys.ts               — PromptKey 枚举
  model_profiles.ts     — LANGUAGE_MAP + MODEL_REFINEMENT_MAP
  variants/
    lang/
      zh.ts             — 中文基础版 (每个 PromptKey 对应一份完整提示词)
      en.ts             — 英文基础版
    models/
      deepseek-v4-pro.ts    — 模型级追加文本 (key → append string, 可选)
      deepseek-v4-flash.ts
      gpt-4o.ts
      claude-sonnet.ts
```

## 核心机制

### resolve() 流程

```
resolvePrompt(BASE_SYSTEM, "deepseek", "deepseek-v4-pro")

  cacheKey = "BASE_SYSTEM:deepseek:deepseek-v4-pro"
  ↓ cache hit → 直接返回

  ↓ cache miss →
  1. LANGUAGE_MAP["deepseek"] → "zh"
  2. base = lang/zh.ts[BASE_SYSTEM]    ← 完整中文基础提示词
  3. MODEL_REFINEMENT_MAP["deepseek/deepseek-v4-pro"] → ["deepseek-v4-pro"]
  4. append = models/deepseek-v4-pro.ts?.[BASE_SYSTEM]  ← 可选追加
  5. result = [base, append].filter(Boolean).join("\n\n")
  6. cache.set(cacheKey, result)
  7. return result
```

### Provider → Language 映射

| Provider | Language |
|----------|----------|
| `deepseek` | `zh` |
| `openai` | `en` |
| `anthropic` | `en` |
| `*` (default) | `en` |

### 精细化追加规则

- 语言层 (lang/zh.ts) 提供**完整基础提示词**
- 模型层 (models/deepseek-v4-pro.ts) 仅提供**选择性追加文本**
- 追加内容拼接到基础提示词末尾，`\n\n` 分隔
- 未定义的 PromptKey 不追加 (跳过)
- 空字符串不追加

```
最终提示词 = zh_base + "\n\n" + model_append
```

### 缓存策略

- **惰性合成**: `register()` 只存原始字符串，不做拼接
- **首用缓存**: 首次 `resolve()` 时合成并存入 `Map`
- **后续命中**: 同一 `(key, provider, model)` 直接从 Map 取，O(1)
- **失效**: `register()` 时全量清空 `Map`（简单安全，避免追踪依赖链）

### 生命周期

```
server.ts 启动
  └─ registerAllPrompts()
      ├─ 加载 lang/zh.ts → #langBases["zh"]
      ├─ 加载 lang/en.ts → #langBases["en"]
      └─ 加载 models/*.ts → #modelRefinements["deepseek-v4-pro"], ...
         不计算、不缓存 ← 纯存储

首次请求 (cache miss)
  └─ resolvePrompt(BASE_SYSTEM, "deepseek", "deepseek-v4-pro")
      └─ base + append 合成 → cache.set()

后续请求 (cache hit)
  └─ resolvePrompt(BASE_SYSTEM, "deepseek", "deepseek-v4-pro")
      └─ cache.get() → O(1) 直接返回
```

## PromptKey 枚举

| Key | 用途 | 使用位置 |
|-----|------|---------|
| `BASE_SYSTEM` | 主 AI 助手系统提示词 | LoadSystemPromptElement |
| `PREDICT_INTENT` | 意图分类器 | predict-intent.ts |
| `ANALYZE_RESULT` | 会话质量评估 | analyze-result.ts (post-conversation) |
| `EVALUATOR_ANALYZE` | 对话健康监控 | evaluator-analyze.ts (follow-up-evaluator) |
| `COMPRESS_SUMMARIZE` | 历史摘要提示词 | compress-summarize.ts |
| `GUIDANCE_RETRY` | 重试引导注入 | finalize.ts (post-conversation) |
| `EVALUATE_STUCK` | 卡住终止消息模板 | evaluate-finalize.ts |
| `CONTEXT_TOPIC_CONSTRAINT` | 主题约束模板 | collect-context.ts |
| `CONTEXT_DIFFICULTY_RULES` | 难度执行策略模板 | collect-context.ts |
| `CONTEXT_MODEL_UPGRADE` | 模型升级提示文本 | collect-context.ts |
| `CONTEXT_EVALUATOR_HINT` | 评估建议注入模板 | collect-context.ts |
| `CONTEXT_ENV_INFO` | 环境信息模板 | collect-context.ts |
| `TASK_INTENT_DESC` | (不在 registry 中 — 内联映射) | analyze-result.ts |
| `TRUNCATION_MARKER` | 消息截断标记文本 | collect-input.ts |

## 输出安全

### sanatizeForJSON（共享工具函数）

所有 LLM 输出在存储到 session 之前经过双层净化，定义在 `@atom-neo/shared` (`src/packages/shared/src/utils/sanitize.ts`):

| 层 | 技术 | 激活点 |
|----|------|-------|
| `String.toWellFormed()` | ES2024 标准，修复孤立代理对 | stream-llm.ts (源头) |
| 正则 `\\u[0-9a-fA-F]{0,4}` | 剥离字面量 hex escape 文本 | server.ts (防线) |

### TODO 执行提示词变化

| 位置 | 变化 | 版本 |
|------|------|------|
| Step 0 / 任务执行规则 | 新增 "todowrite 工具会拒绝多个 in_progress" 威慑声明 | v1.0.8 |
| CONTEXT_DIFFICULTY_RULES | 强化 "一次只能执行一个任务" 表述 | v1.0.8 |
| collect-context banner | TODO 列表上方注入醒目横幅提醒 | v1.0.8 |
| 执行规则 / intent 说明 | 禁止进度叙述/自我对话（"第X步完成"等） | v1.1.0 |

## 模型级精细化示例

每个模型可通过对应文件选择性地对特定 PromptKey 进行追加调优。未定义的 Key 不追加，空字符串不追加。

| 模型文件 | 追加的 PromptKey |
|----------|-----------------|
| `deepseek-v4-pro.ts` | `BASE_SYSTEM`, `EVALUATOR_ANALYZE` |
| `deepseek-v4-flash.ts` | `BASE_SYSTEM` |
| `gpt-4o.ts` | `BASE_SYSTEM`, `PREDICT_INTENT` |
| `claude-sonnet.ts` | `BASE_SYSTEM`, `PREDICT_INTENT` |

```ts
// models/deepseek-v4-pro.ts — 追加到 BASE_SYSTEM 末尾
export default {
  [PromptKey.BASE_SYSTEM]: `
[DeepSeek V4 Pro 优化]
你拥有强大的推理能力，鼓励使用思维链路：
- 复杂任务先分析再执行
- 工具调用失败后分析原因再重试
- 输出若超过 2000 字，自动分步输出
`.trim(),
};
```

只有需要微调的 key 才在 model 文件中定义，其余省略。

## 涉及变更的文件

```
docs/pipelines/prompts.md                          本文档
src/packages/shared/src/prompts/index.ts            公共 API
src/packages/shared/src/prompts/registry.ts         PromptRegistry 类
src/packages/shared/src/prompts/keys.ts             PromptKey 枚举
src/packages/shared/src/prompts/model_profiles.ts   语言映射 + 模型精细化映射
src/packages/shared/src/prompts/variants/lang/zh.ts 中文基础提示词
src/packages/shared/src/prompts/variants/lang/en.ts 英文基础提示词
src/packages/shared/src/prompts/variants/models/*.ts 模型级追加文本
src/packages/core/src/pipelines/conversation/elements/load-system-prompt.ts   改用 resolvePrompt()
src/packages/core/src/pipelines/conversation/elements/collect-context.ts      改用 resolvePrompt()
src/packages/core/src/pipelines/prediction/elements/predict-intent.ts         改用 resolvePrompt()
src/packages/core/src/pipelines/post-conversation/elements/analyze-result.ts  改用 resolvePrompt()
src/packages/core/src/pipelines/post-conversation/elements/finalize.ts        改用 resolvePrompt()
src/packages/core/src/pipelines/post-conversation/elements/collect-input.ts   改用 resolvePrompt()
src/packages/core/src/pipelines/follow-up-evaluator/elements/evaluator-analyze.ts  改用 resolvePrompt()
src/packages/core/src/pipelines/follow-up-evaluator/elements/evaluate-finalize.ts  改用 resolvePrompt()
src/packages/core/src/pipelines/context-compress/elements/compress-summarize.ts    改用 resolvePrompt()
src/packages/core/src/server.ts                      registerAllPrompts() 调用
src/assets/prompts/base_system_prompt.md             保留弃用标记（variants/lang/zh.ts 替代）
src/packages/core/src/pipelines/conversation/index.ts 传递 providerModel 到 LoadSystemPrompt + CollectContext
```

## 相关文档

| 文档 | 说明 |
|------|------|
| [conversation.md](./conversation.md) | 各 Element 如何通过 resolvePrompt() 获取提示词 |
| [agents-compiler.md](../subsystems/agents-compiler.md) | AGENTS.md 编译器 — 另一个提示词生成源 |```
