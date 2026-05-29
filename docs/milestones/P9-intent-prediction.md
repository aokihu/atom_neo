# P9: User Intent Prediction Pipeline — 实施方案

## 目标

在 Conversation Pipeline 之前插入轻量级预测 Pipeline，用 basic 模型对用户意图做分类，输出工具集需求和任务难度。消除 `REQUEST_MORE_TOOLS` 的额外轮次，并为将来动态模型选择做好准备。

## 架构

```
POST /api/tasks
  │
  │  (1) Prediction Pipeline — 非流式，结果不展示给用户
  ├── predict-input → predict-intent → predict-finalize
  │       │
  │       ▼  输出: { toolTier, difficulty, reasoning }
  │       │
  │       └── predict-finalize 内部：
  │             ① 写入 session.pendingPrediction = { toolTier, difficulty }
  │             ② createTaskItem({ pipeline:"conversation", source:INTERNAL,
  │                  parentTaskId: predictionTask.id })
  │             ③ queue.enqueue(convTask)
  │             （不再构建 pipeline — 由 TaskEngine 延迟构建）
  │
  │  (2) TaskEngine 取到 conversation task:
  │       getPipeline(taskId) → null → pipelineBuilders["conversation"](task)
  │       → 读 session.pendingPrediction → 选 tools + 选 model
  │       → build + setPipeline → 执行
  │
  │  (3) Conversation Pipeline — 流式，展示给用户
  └── collect-prompts → ... → stream-llm → parse-intents → check-follow-up → finalize
          │                    ▲
          │                    └── tools: 预测结果决定；model: 预测结果决定
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

Reply with JSON: {"tool_tier":"...", "difficulty":"...", "reasoning":"brief explanation"}
```

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

## 组件

### Elements（3 个）

| Element | Kind | 职责 |
|---------|------|------|
| `predict-input` | source | 提取用户消息 + 对话上下文 |
| `predict-intent` | transform | 调用 `generateText`（非流式）分类 |
| `predict-finalize` | sink | 写 session → 建 conversation task → 入队 |

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
| `task-factory.ts` | **修改** | parentTaskId 默认自引用 |
| `task-engine.ts` | **修改** | 增加 pipelineBuilders 参数 + 延迟构建逻辑 |
| `elements/predict-finalize.ts` | **新建** | 精简版 sink（§4） |
| `elements/route-conversation.ts` | **删除** | 不再需要 |
| `elements/types.ts` | **修改** | 更新 PredictionPipelineDeps |
| `elements/index.ts` | **修改** | 导出 predict-finalize |
| `prediction/index.ts` | **修改** | DSL sink 改名 |
| `server.ts` | **修改** | 删 buildConversation；注册 pipelineBuilders；TaskCompleted +parentTaskId |
| `ws-client.ts` | **修改** | send() 按 parentTaskId 判断；无 fallback |
| `useChat.ts` | **修改** | 删 send() 中 spinner 移除 |
| `ChatView.tsx` | **修改** | 80ms 帧率 |
| `prediction.test.ts` | **修改** | 更新测试 |
| `task-engine.test.ts` | **新建** | pipelineBuilders 延迟构建测试 |

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

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 预测不准，把"full"判成"basic" | conversation pipeline 保留 REQUEST_MORE_TOOLS 兜底 |
| 预测增加每次对话 1 次 LLM 调用 | 用 basic 模型（最轻量），非 stream 模式返回更快 |
| 预测失败导致整体流程阻塞 | try/catch fallback 到默认值 |
| parentTaskId 改动影响已有逻辑 | 单行改动，所有现有测试通过即为安全 |

## 验收标准

1. [ ] Prediction Pipeline 正确分类（14 个测试场景）
2. [ ] 高级工具场景不出现 REQUEST_MORE_TOOLS 额外轮次
3. [ ] 简单任务不加载高级工具
4. [ ] 预测失败优雅降级，不影响核心对话
5. [ ] TUI spinner 在预测期间保持显示，文本到达后隐藏
6. [ ] TUI 按 parentTaskId 正确判断会话完成
7. [ ] 所有已有测试通过
