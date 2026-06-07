# Session Lifecycle — 会话生命周期

## 职责

定义从用户发送消息到会话彻底结束的完整生命周期，以及 TUI 如何准确反映当前会话状态。

## 问题

```
用户发送消息
├── thinking (spinner 显示)           ← 瞬间
├── 第一个 text delta (spinner 消失)   ← 可能很快
├── 文本流式输出 (无指示器)            ← 可能很长
├── 工具调用 (StatusLine ⏳ processing)
└── follow_up 链式任务 (无任何指示器!)  ← 用户看到空白，误以为宕机
```

Spinner 的生命周期绑定在"**第一个 text delta 到达**"这一时刻，但真正的会话结束时刻是 `TaskCompleted`（根任务 resolve）。两者之间存在巨大时间差。

### 三种 gap 场景

| 场景 | 现象 | 后果 |
|------|------|------|
| 链式任务间隙 | 文本输出完了，系统内部在做 follow_up 链 | 用户屏幕空白，以为会话结束 |
| 纯工具响应 | 无文本输出，spinner 永不消失 | 用户困惑 |
| 流式文本结束后 | 文本已完成但 TaskCompleted 未到 | 用户提前输入新消息 |

## 方案

引入 `sessionBusy` 状态，覆盖会话完整生命周期。

### 生命周期对比

```
之前:
  thinking msg 添加 → first delta → thinking msg 移除（此后无指示器）

之后:
  send() 调用 → sessionBusy = true
    ├── thinking msg 可见（spinner）— 无文本输出时
    ├── 文本开始 → thinking 移除，StatusLine ⏳ processing — 有文本输出时
    ├── 工具执行 → StatusLine ⏳ processing
    ├── 链式任务间隙 → thinking msg 短暂显示 — 无文本输出时
    └── 链式文本 → thinking 移除，StatusLine ⏳ processing
  send() resolve/reject → sessionBusy = false → 一切清空
```

### 规则

| 条件 | Spinner | StatusLine |
|------|---------|-----------|
| `sessionBusy && 无流式文本 && 无运行中工具` | 显示 | `⏳ processing...` |
| `sessionBusy && (流式文本 \|\| 运行中工具)` | 隐藏 | `⏳ processing...` |
| `!sessionBusy` | 隐藏 | 隐藏 |

### 关键设计

- **thinking message 不再在 first delta 时移除** — 改为在 `sessionBusy` 变为 `false` 或 first delta 到达（二选一，first delta 到达后说明文本正在输出，spinner 不再需要）
- **`sessionBusy` 覆盖链式任务** — `send()` 的 `await` 会一直等到根 `TaskCompleted` 才 resolve，所以链式任务执行期间 `sessionBusy` 保持 `true`
- **工具执行期间有 StatusLine** — 已有的 `tool.state === "running"` 检查保持不变，但加入 `sessionBusy` 作为兜底

### 视觉状态机

```
                 ┌────────────────────────────────────────────────────┐
                 │  sessionBusy = true                                │
                 │                                                    │
  ┌──────┐    ┌──┴───────┐    ┌──────────────┐    ┌──────────────┐   │
  │ idle │───>│ waiting  │───>│  responding  │───>│  chaining    │   │
  └──────┘    │ spinner  │    │  streaming   │    │ spinner/     │   │
              └──────────┘    │  ⏳ process   │    │ ⏳ process   │   │
                              └──────────────┘    └──────┬───────┘   │
                                                         │ 循环       │
                                                         └───────────┘
  sessionBusy = false
  ┌──────┐
  │ idle │
  └──────┘
```

## 涉及文件

```
docs/pipelines/session-lifecycle.md               本文档
src/packages/tui/src/hooks/useChat.ts              sessionBusy state
src/packages/tui/src/components/App.tsx            isProcessing 改为 sessionBusy 驱动
src/packages/tui/src/components/ChatView.tsx       无变化（通过 thinking 消息控制 spinner）
src/packages/tui/src/types.ts                      Message 类型无变化
```
