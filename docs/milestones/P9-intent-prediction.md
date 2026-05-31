# P9: User Intent Prediction Pipeline — 实施方案

## 目标

在 Conversation Pipeline 之前插入轻量级预测 Pipeline，用 basic 模型对用户意图做分类，输出工具集需求、任务类型、上下文关联度。消除 `REQUEST_MORE_TOOLS` 的额外轮次，优化正式会话的上下文管理和工具分配。

## 架构

```
POST /api/tasks
  │  server.ts: createTask({ pipeline:"prediction" }) + enqueue
  │  (不 build pipeline, 不调 setPipeline)
  ▼
TaskEngine: getPipeline→null → pipelineBuilders["prediction"] → build + setPipeline
  │
  │  (1) Prediction Pipeline — 非流式，结果不展示给用户
  ├── predict-input → predict-intent → predict-finalize
  │       │
  │       ▼  输出: { toolTier, difficulty, taskIntent, contextRelevance, reasoning }
  │       │
  │       └── predict-finalize 内部：
  │             ① 写入 session.pendingPrediction = { toolTier, difficulty, taskIntent, contextRelevance }
  │             ② createTaskItem({ pipeline:"conversation", source:INTERNAL,
  │                  parentTaskId: predictionTask.id })
  │             ③ queue.enqueue(convTask)
  │             （不再构建 pipeline — 由 TaskEngine 延迟构建）
  │
  │  (2) TaskEngine 取到 conversation task:
  │       getPipeline→null → pipelineBuilders["conversation"](task)
  │       → 读 session.pendingPrediction → 选 tools + 选 model + 调节 context
  │       → build + setPipeline → 执行
  │
  │  (3) Conversation Pipeline — 流式，展示给用户
  └── collect-prompts → ... → stream-llm → parse-intents → check-follow-up → finalize
           │                    ▲
           │                    └── tools: taskIntent 决定；model: difficulty 决定
           │                    └── context window: contextRelevance 决定
           │
           │   parse-intents + check-follow-up 保留作为兜底
           ▼
       用户看到回复
```

### 关键设计决策

| 决策 | 说明 |
|------|------|
| **TaskEngine 延迟构建** | TaskEngine 持有 `pipelineBuilders`，按 task.pipeline 字段匹配 builder。构建逻辑集中在 server.ts 的闭包中，TaskEngine 不接触业务数据 |
| **parentTaskId 永不 null** | 根 task 自引用 `parentTaskId = taskId`；子 task 指向父 task。TUI 端判断条件：`parentTaskId === rootTaskId && taskId !== rootTaskId` |
| **predict-finalize 极简** | 只做三件事：写 session、建 task、入队。不碰 pipeline 构建。依赖只有 `queue` |

### 预测 LLM 的 System Prompt

分类任务，非流式 `generateText`：

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

3. task_intent: "tool_execution" | "creative_generation" | "knowledge_retrieval" | "conversation"
   - "tool_execution": executing commands, querying APIs, manipulating files
   - "creative_generation": writing long articles, generating code, composing text
   - "knowledge_retrieval": searching memory, looking up documentation, recalling facts
   - "conversation": casual chat, Q&A, brief explanations

4. context_relevance: "standalone" | "follow_up" | "continuation"
   - "standalone": new topic, unrelated to conversation history
   - "follow_up": follows up on the previous response, needs full context
   - "continuation": explicitly continuing a previously interrupted task

Reply with JSON: {"tool_tier":"...", "difficulty":"...", "task_intent":"...", "context_relevance":"...", "reasoning":"brief explanation"}
```

### 预测输出 → 正式会话参数

| 预测字段 | 值 | 工具集 | memory search | context window |
|---------|-----|--------|--------------|----------------|
| **taskIntent** | `tool_execution` | full（12 tools） | 开启 | 保留全部 |
| | `creative_generation` | 无工具 | 关闭 | 保留全部 |
| | `knowledge_retrieval` | basic + 搜索类 | 开启 | 保留全部 |
| | `conversation` | basic（不含 search_memory） | 关闭 | 保留全部 |
| **contextRelevance** | `standalone` | — | — | 只保留最近 2 轮 |
| | `follow_up` | — | — | 保留全部 |
| | `continuation` | — | — | 保留全部 + 不 reset chainDepth |

### 模型选择策略

| difficulty | ProfileLevel | 说明 |
|-----------|-------------|------|
| "basic" | `getResolvedModel("basic")` | 简单任务用轻量模型 |
| "balanced" | `getResolvedModel("balanced")` | 默认 |
| "advanced" | `getResolvedModel("advanced")` | 复杂任务用强模型 |

### 工具选择策略

| toolTier | 工具集 | 说明 |
|----------|--------|------|
| "basic" | `basic` (8 tools) | 读写、搜索、目录列表、基础记忆 |
| "full" | `basic + advanced` (12 tools) | 额外包括 bash, cp, mv, traverse_memory |

> **注意**：上述工具集是**上限**。最终传给 LLM 的工具还受 `taskIntent` 进一步约束。例如 `taskIntent = "creative_generation"` 时即使 `toolTier = "full"` 也不传任何工具。

## 组件

### Elements（3 个）

| Element | Kind | 职责 |
|---------|------|------|
| `predict-input` | source | 提取用户消息 + 对话上下文 |
| `predict-intent` | transform | 调用 `generateText`（非流式）分类 |
| `predict-finalize` | sink | 写 session → 建 conversation task → 入队 |

### PredictionFlowState 类型

```typescript
type PredictionMode = "initial" | "predicting" | "routing";

type PredictionFlowState = {
  mode: PredictionMode;
  task: any;
  session: any;
  userMessage: string;
  contextMessages?: string;
  prediction?: IntentPredictionResult;
};
```

### IntentPredictionResult 类型

```typescript
type IntentPredictionResult = {
  toolTier: "basic" | "full";
  difficulty: "basic" | "balanced" | "advanced";
  taskIntent: "tool_execution" | "creative_generation" | "knowledge_retrieval" | "conversation";
  contextRelevance: "standalone" | "follow_up" | "continuation";
  reasoning: string;
};
```

### TaskEngine 扩展

新增 `pipelineBuilders` 参数：`Record<string, (task: TaskItem) => Pipeline | undefined>`。

```typescript
class TaskEngine {
  #pipelineBuilders: Record<string, PipelineBuilder>;

  async #executeTask(task: TaskItem) {
    let pipeline = getPipeline(task.id);
    if (!pipeline && task.pipeline) {
      const builder = this.#pipelineBuilders[task.pipeline];
      if (builder) {
        pipeline = builder(task);
        if (pipeline) setPipeline(task.id, pipeline);
      }
    }
    if (!pipeline) return { type: "complete", task };
    // ... 执行
  }
}
```

### parentTaskId 语义

修改 `task-factory.ts`（一行）：

```diff
- parentTaskId: params.parentTaskId ?? null,
+ parentTaskId: params.parentTaskId ?? id,
```

## 改动文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `prediction/elements/types.ts` | **修改** | 新增 `taskIntent`、`contextRelevance` 字段 |
| `prediction/elements/predict-intent.ts` | **修改** | 更新 system prompt + 解析逻辑 |
| `prediction/elements/predict-finalize.ts` | **修改** | 传递新字段到 session |
| `prediction/elements/predict-input.ts` | **修改** | 无需改动（输入不变） |
| `prediction/index.ts` | **修改** | 无需改动（deps 不变） |
| `conversation/index.ts` | **修改** | 新增 `taskIntent`、`contextRelevance` 到 deps |
| `collect-prompts.ts` | **修改** | 根据 `contextRelevance` 控制保留消息数 |
| `collect-context.ts` | **修改** | 根据 `taskIntent` 控制 memory search |
| `stream-llm.ts` | **修改** | 根据 `taskIntent` 过滤工具集 |
| `server.ts` | **修改** | 从 session.pendingPrediction 读取新字段 |
| `types/prediction.ts` (shared) | **修改** | 更新 `IntentPredictionResult` 类型 |
| `prediction.test.ts` | **修改** | 更新测试用例 |

## 测试用例

### 单元测试 — 完整维度

| 测试场景 | toolTier | difficulty | taskIntent | contextRelevance |
|----------|----------|-----------|------------|-----------------|
| 天气查询 | full | balanced | tool_execution | standalone |
| 运行命令 | full | balanced | tool_execution | standalone |
| docker 检查 | full | balanced | tool_execution | standalone |
| git 操作 | full | balanced | tool_execution | standalone |
| 批量文件 | full | balanced | tool_execution | standalone |
| 部署操作 | full | advanced | tool_execution | standalone |
| 读文件 | basic | basic | tool_execution | standalone |
| 搜索 | basic | basic | knowledge_retrieval | standalone |
| 列出文件 | basic | basic | tool_execution | standalone |
| 写长文 | basic | balanced | creative_generation | standalone |
| 生成代码 | basic | balanced | creative_generation | standalone |
| 简单修改 | basic | basic | tool_execution | standalone |
| 概念解释 | basic | basic | conversation | standalone |
| 追问上一轮 | basic | basic | conversation | follow_up |
| 继续上次任务 | basic | balanced | creative_generation | continuation |
| 空消息 | basic | basic(?) | conversation(?) | standalone(?) |

### TaskEngine 测试

| 测试场景 | 说明 |
|----------|------|
| pipelineBuilder 命中 | task.pipeline="conversation" → builder 被调用 → 拿到 Pipeline |
| pipelineBuilder 未命中 | task.pipeline="unknown" → builder 不调用 → pipeline 为 null |
| setPipeline 已有 | pipelineMap 已有 → 不调 builder，直接用 |

### 集成测试

1. **完整流程** — POST 发送天气查询 → prediction → conversation 用 full tools → LLM 用 bash+curl 返回
2. **降级** — 预测失败 → fallback basic+balanced → REQUEST_MORE_TOOLS 兜底
3. **简单任务不浪费** — POST 读文件请求 → prediction basic+basic → 只用 basic tools
4. **纯文本任务无工具** — POST 写长文请求 → taskIntent=creative_generation → 不传任何工具，LLM 不被工具干扰
5. **上下文修剪** — 重 session 中猜新话题 → contextRelevance=standalone → 只传最近 2 轮，LLM 响应速度提升

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 预测不准，把"full"判成"basic" | conversation pipeline 保留 REQUEST_MORE_TOOLS 兜底 |
| 预测增加每次对话 1 次 LLM 调用 | 用 basic 模型（最轻量），非 stream 模式返回更快 |
| 预测失败导致整体流程阻塞 | try/catch fallback 到默认值 |
| parentTaskId 改动影响已有逻辑 | 单行改动，所有现有测试通过即为安全 |
| contextRelevance 误判为 standalone | 极端情况只少传几轮消息，不影响对话正确性 |

## 验收标准

1. [ ] Prediction Pipeline 正确分类全部 16 个测试场景
2. [ ] 高级工具场景不出现 REQUEST_MORE_TOOLS 额外轮次
3. [ ] 简单任务不加载高级工具
4. [ ] 纯文本生成任务（creative_generation）不传工具
5. [ ] standalone 模式下 context 被正确修剪
6. [ ] follow_up / continuation 模式下 context 完整保留
7. [ ] 预测失败优雅降级，不影响核心对话
8. [ ] TUI spinner 在预测期间保持显示，文本到达后隐藏
9. [ ] TUI 按 parentTaskId 正确判断会话完成
10. [ ] 所有已有测试通过
