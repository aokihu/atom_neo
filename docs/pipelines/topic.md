# Topic 系统

## 职责

会话主题跟踪与状态管理。通过 predict-intent LLM 对用户输入进行主题分类，在 predict-finalize 阶段检测主题变化，触发 `SessionContext.resetForNewTopic()`。主题约束注入 context 供 LLM 感知，stream-llm 的 activeTools 由 taskIntent 独立控制，形成双重边界。

## 设计原则

- **系统驱动切换** — topic 由 prediction pipeline 自动检测变化，LLM 不参与切换决策
- **LLM 不判边界** — LLM 看到 `[主题约束]` 后专注当前主题，不拒绝用户请求，不主动跑题
- **保留历史** — topic 切换时保留 messages/inferenceFacts/memoryScopes/tokenUsage
- **重置任务状态** — todoState/chainDepth/toolContext/continuationContext 等随 topic 切换清空

## 触发流程

```
用户输入
  ↓
predict-intent (5字段分类，含 topic)
  ↓
predict-finalize:
  ├─ newTopic !== session.currentTopic → session.resetForNewTopic(newTopic)
  │   └─ 清空: todoState, chainDepth, toolContext, continuationContext
  │       保留: messages, inferenceFacts, memoryScopes, tokenUsage
  └─ newTopic === session.currentTopic → 保持上下文
  ↓
collect-context:
  注入 [主题约束] 当前主题: xxx 到上下文中
  ↓
stream-llm:
  activeTools 由 taskIntent 控制 (creative→todowrite+intent, tool_execution→全工具)
  LLM 在主题约束下工作
```

## Topic 格式

```
<category>.<domain>.<specific>

categories: creative | tools | code | knowledge | chat
```

| 示例 | 含义 |
|------|------|
| `creative.history.ancient` | 创作：古代历史文章 |
| `tools.filesystem.explore` | 工具：浏览文件系统 |
| `code.warehouse.management` | 编码：仓库管理系统 |
| `knowledge.weather.query` | 知识：天气查询 |
| `chat.greeting` | 对话：问候 |

## Topic 稳定性

predict-intent prompt 指导 LLM 生成稳定 topic：

- 同类追问 → 相同 topic（如 "继续写第2段" → topic 不变）
- 明确新话题 → 新 topic（如 "帮我查天气" → topic 变化）
- 不因措辞微小变化产生 topic 漂移

## LLM 约束注入

collect-context 在上下文中注入：

```
[主题约束]
当前主题: creative.history.ancient
- 所有输出和工具调用必须服务于当前主题目标
- 不要主动偏离或切换主题
- 主题切换由系统自动管理，对你透明
```

## 双重边界

| 边界层 | 实现 | 效果 |
|--------|------|------|
| 主题约束 | context 注入 + activeTools | LLM 被约束在主题范围内 |
| 工具过滤 | taskIntent → getActiveToolNames() | creative→2个工具，tool_execution→全工具 |

## 与 contextRelevance 的关系

| contextRelevance | topic 行为 |
|-----------------|-----------|
| `standalone` | 通常伴随 topic 变化，触发 reset |
| `follow_up` / `continuation` | 通常 topic 不变，保持上下文 |

两个字段独立判断：contextRelevance 决定消息可见范围，topic 决定状态是否重置。

## 文件

```
docs/pipelines/topic.md                         本文档
src/packages/shared/src/types/intent.ts          IntentPredictionResult.topic
src/packages/core/src/pipelines/prediction/elements/predict-intent.ts    topic 分类 prompt
src/packages/core/src/pipelines/prediction/elements/predict-finalize.ts  topic 变化检测
src/packages/core/src/session/context.ts         currentTopic + resetForNewTopic()
src/packages/core/src/pipelines/conversation/elements/collect-context.ts 主题约束注入
src/assets/prompts/base_system_prompt.md         主题约束规则
```
