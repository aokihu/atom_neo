# P9: User Intent Prediction Pipeline — 实施方案

## 目标

在 Conversation Pipeline 之前插入轻量级预测 Pipeline，用 basic 模型对用户意图做分类，输出工具集需求和任务难度。消除 `REQUEST_MORE_TOOLS` 的额外轮次，并为将来动态模型选择做好准备。

## 架构

```
POST /api/tasks
  │
  │  (1) Prediction Pipeline — 非流式，结果不展示给用户
  ├── taskIntentPredictor: predict-input → predict-intent → route-conversation
  │       │
  │       ▼  输出: { toolTier, difficulty, reasoning }
  │       │
  │       └── route-conversation 内部：
  │             根据预测结果构建 conversationPipeline(tools, model)
  │             → createTaskItem(TaskSource.INTERNAL)
  │             → setPipeline → queue.enqueue
  │
  │  (2) Conversation Pipeline — 流式，展示给用户
  └── collect-prompts → ... → stream-llm → parse-intents → check-follow-up → finalize
          │                    ▲
          │                    └── tools: 预测结果决定；model: 预测结果决定
          │
          │   parse-intents + check-follow-up 保留作为兜底
          │   （即使预加载了工具，LLM 仍可能主动发 REQUEST_MORE_TOOLS）
          ▼
      用户看到回复
```

### 预测 LLM 的 System Prompt

分类任务，非流式 `generateText`，用 `structured output`（JSON Schema）保证格式：

```text
You are an intent classifier. Analyze the user's message and classify:

1. tool_tier: "basic" or "full"
   - "full": requires shell commands (bash), network access (curl/wget), 
             batch file operations (cp/mv), or memory recall (traverse_memory)
   - "basic": only needs file read/write, search, directory listing

2. difficulty: "basic", "balanced", or "advanced"
   - "basic": single-step read/search/edit
   - "balanced": multi-step tasks, code generation, moderate changes
   - "advanced": system design, architecture refactoring, complex debugging

Reply with JSON: {"tool_tier":"...", "difficulty":"...", "reasoning":"brief explanation"}
```

### 模型选择策略

| difficulty | ProfileLevel | 说明 |
|-----------|-------------|------|
| "basic" | `getResolvedModel("basic")` | 简单任务用轻量模型 |
| "balanced" | `getResolvedModel("balanced")` | 默认，当前行为 |
| "advanced" | `getResolvedModel("advanced")` | 复杂任务用强模型 |

### 工具选择策略

| toolTier | 工具集 | 说明 |
|----------|--------|------|
| "basic" | `basic` (8 tools) | 读写、搜索、目录列表、基础记忆 |
| "full" | `basic + advanced` (12 tools) | 额外包括 bash, cp, mv, traverse_memory |

## 组件

### Elements（3 个）

| Element | Kind | 职责 |
|---------|------|------|
| `predict-input` | source | 从 task payload 提取最后一条用户消息文本；若空则从 session 补全 |
| `predict-intent` | transform | 调用 `generateText`（非流式）对用户消息分类，解析返回 JSON |
| `route-conversation` | sink | 根据预测结果构建 conversation pipeline，创建内部 task 并入队 |

### FlowState

```typescript
type PredictionMode = "initial" | "predicting" | "routing";

type PredictionFlowState = {
  mode: PredictionMode;
  task: TaskItem;
  session: SessionStore;
  userMessage: string;       // predict-input 提取
  prediction?: {
    toolTier: "basic" | "full";
    difficulty: "basic" | "balanced" | "advanced";
    reasoning: string;
  };
  error?: string;            // predict-intent 失败时的降级信息
};
```

### 关键细节

1. **非流式调用** — 使用 `generateText`（非 `streamText`），因为预测结果不需要展示给用户
2. **超时保护** — 预测 LLM 调用设置 10 秒超时，超时则 fallback
3. **降级策略** — 预测失败时（JSON 解析错误、超时、模型不可用），fallback 到 `{ toolTier: "basic", difficulty: "balanced" }`
4. **结构化输出** — 使用 AI SDK 的 `jsonSchema` 定义输出格式，确保 JSON 可解析
5. **网络隔离** — 预测 LLM 的 system prompt 不包含高级工具的描述，避免影响分类判断

## 改动文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/packages/core/src/pipelines/prediction/elements/types.ts` | **新建** | PredictionMode + PredictionFlowState 类型定义 |
| `src/packages/core/src/pipelines/prediction/elements/predict-input.ts` | **新建** | Source: 提取用户消息 |
| `src/packages/core/src/pipelines/prediction/elements/predict-intent.ts` | **新建** | Transform: LLM 分类 |
| `src/packages/core/src/pipelines/prediction/elements/route-conversation.ts` | **新建** | Sink: 构建 conversation 并入队 |
| `src/packages/core/src/pipelines/prediction/elements/index.ts` | **新建** | 注册 3 个 element |
| `src/packages/core/src/pipelines/prediction/index.ts` | **重写** | predictionPipeline(deps) DSL 定义 |
| `src/packages/shared/src/types/intent.ts` | **修改** | 新增 `IntentPredictionResult` 类型 |
| `src/packages/core/src/pipeline/registry.ts` | **修改** | 注册 3 个新 element |
| `src/packages/core/src/server.ts` | **修改** | 注入 prediction deps，POST /api/tasks 先创建 prediction pipeline |
| `src/packages/core/src/index.ts` | **修改** | 导出 prediction pipeline builder |

## 测试用例

### 单元测试

| 测试场景 | 输入 | 期望 toolTier | 期望 difficulty |
|----------|------|--------------|----------------|
| 天气查询 | "帮我查一下杭州明天的天气" | full | balanced |
| 运行命令 | "运行 npm install 安装依赖" | full | balanced |
| docker 检查 | "检查系统有没有安装 docker" | full | balanced |
| git 操作 | "从 github 克隆这个仓库" | full | balanced |
| 批量文件 | "把 src 目录复制到 dist" | full | balanced |
| 部署操作 | "部署这个项目到生产环境" | full | advanced |
| 读文件 | "读一下 package.json" | basic | basic |
| 搜索 | "搜索包含 TODO 的文件" | basic | basic |
| 列出文件 | "列出当前目录下的所有文件" | basic | basic |
| 简单修改 | "把 foo 改成 bar" | basic | basic |
| 概念解释 | "什么是闭包" | basic | basic |
| 多步骤编辑 | "先读 config，再根据配置修改代码" | basic | balanced |
| 架构重构 | "设计一个微服务架构方案" | basic | advanced |
| 空消息 | "" | basic | basic (fallback) |

### 集成测试

1. **完整流程** — POST /api/tasks 发送天气查询 → prediction pipeline 识别为 full+balanced → conversation pipeline 用 full tools 启动 → LLM 直接用 bash+curl 返回天气
2. **降级** — 模拟预测失败（错误的 apiKey）→ fallback 到 basic+balanced → 仍可通过 conversation pipeline 的 REQUEST_MORE_TOOLS 兜底
3. **简单任务不浪费** — POST 发送读文件请求 → prediction 识别为 basic+basic → conversation 只用 basic tools + basic model

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 预测不准，把"full"判成"basic" | conversation pipeline 保留 REQUEST_MORE_TOOLS 兜底 |
| 预测增加每次对话 1 次 LLM 调用，增加延迟 | 用 basic 模型（最轻量），设置 10s 超时；非 stream 模式返回更快 |
| 预测失败导致整体流程阻塞 | try/catch 包裹 predict-intent，失败时 fallback 到默认值 |
| basic 模型分类能力不足 | system prompt 精简到最小，任务明确（二分类+三分类），边界清晰 |

## 验收标准

1. [ ] Prediction Pipeline 正确分类工具需求（单元测试 14 个场景 100% pass）
2. [ ] 需要高级工具的场景不再出现 `REQUEST_MORE_TOOLS` 额外轮次
3. [ ] 简单任务场景不加载高级工具，不浪费上下文
4. [ ] 预测失败时不影响核心对话功能（优雅降级）
5. [ ] 现有 130 个测试全部通过
6. [ ] 文档同步更新（development-plan.md, index.md, pipeline-builder.md）
