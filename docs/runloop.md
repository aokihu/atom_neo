# TaskEngine Runloop — 任务状态机

> **版本**: v0.5.3 →  FinalizeElement 统一收口

---

## 问题

当前 `needMoreTools` 链式续接逻辑散落在 `server.ts` 的 `bus.on("task.completed")` handler 中，跨越 TaskEngine → server.ts 两个文件的回调跳转：

```
TaskEngine: pipeline完成 → COMPLETED → emit "task.completed"
               ↓ 跨越文件边界 ↓
server.ts:   检查 needMoreTools → 创建 task_B → 构建 pipeline → enqueue
```

## 方案：FinalizeElement 统一收口

将链任务创建逻辑从 `server.ts` 内聚到 `FinalizeElement`（pipeline 的终点元素），线性控制流：

```
TaskEngine.#processNext()
  └─ pipeline 执行 (10 elements)
       └─ FinalizeElement.doProcess()
            ├─ if needMoreTools:
            │    task_B = createTaskItem(INTERNAL)
            │    setPipeline(task_B, ...)
            │    queue.enqueue(task_B)           ← ActiveQueue (LIFO)
            │
            └─ return { type: "complete", output, needMoreTools }

TaskEngine: 拿结果 → COMPLETED → 收工
```

## 数据流

```
FinalizeElement
  │
  ├─ 注入依赖：
  │    queue:      TaskQueue           ← enqueue 链任务
  │    sandbox:    string               ← 构建 pipeline 用
  │    pipelineDeps: object             ← { apiKey, model, baseUrl, tools... }
  │    sessionStore/memory/compiledPrompt ← 构建 pipeline 用
  │
  ├─ 决策逻辑：
  │    input.needMoreTools === true ?
  │      ├─ 创建 INTERNAL task (chainId 继承父任务)
  │      ├─ 构建 conversationPipeline({ tools: basic+advanced })
  │      ├─ setPipeline(taskId, pipeline)
  │      └─ queue.enqueue(task)
  │
  └─ 返回：
       { type: "complete", task, output, needMoreTools }
```

## server.ts 简化

```
之前:  ~45 行（存 session + 广播 + needMoreTools 逻辑）
之后:  ~15 行（存 session + 广播）
```

`server.ts` 不再知道 `needMoreTools`、`basic vs advanced tools` 的存在。它只管 HTTP/WS 层。

## 关键约束

- `FinalizeElement` 不等待链任务执行 — 只负责创建和入队
- 双队列保证链任务不被打断 — 详见 [queue.md](./queue.md)
- `bus.emit("task.completed")` 仅做日志/广播，不创建任务
- 链任务 parentTaskId 指向父任务，chainId 继承

## 与 atom_next 对比

| | atom_neo (之前) | atom_neo (之后) | atom_next |
|---|-----------------|-----------------|-----------|
| 链任务创建位置 | server.ts bus handler | FinalizeElement | Runtime (intent dispatch) |
| 控制流 | 跨文件 event | 线性 | 线性 |
| server 职责 | HTTP + WS + pipeline 细节 | HTTP + WS | HTTP + WS |
