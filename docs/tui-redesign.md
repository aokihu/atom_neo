# TUI 重构方案 — OpenTUI + React

> **状态**: 待实施
> **目标**: 用 OpenTUI React 绑定重写终端界面，达到与 OpenCode 同等的交互体验

---

## 1. 动机

当前 TUI 基于 `node:readline` 实现（`src/packages/tui/src/app.tsx`，71 行），仅支持基本的 REPL + 流式输出。问题：

| 缺陷 | 影响 |
|------|------|
| 无工具执行反馈 | `transport.tool.started/finished` 事件被忽略 |
| 无等待指示器 | 用户无法区分"流生成中"与"卡死" |
| 无 Markdown 渲染 | 代码块、列表、表格均为纯文本 |
| 无会话视觉区分 | 用户/助手/工具消息无法通过样式区分 |
| 无运行时信息面板 | 无法查看服务状态 |
| 无法自适应终端宽度 | 窄终端下体验差 |

## 2. 技术选型

| 层 | 选型 | 替代 |
|----|------|------|
| 渲染引擎 | `@opentui/core` (Zig 原生核心 + TS 绑定) | `node:readline` |
| 组件框架 | `@opentui/react` (React Reconciler) | 手工 ANSI |
| 构建前提 | Zig 0.15+ (已安装 0.16.0) | — |
| 通信层 | 保留 `ws-client.ts` | — |

**OpenTUI 原生 Zig 核心**提供 Yoga Flexbox 布局、Tree-sitter 语法高亮、Markdown 渲染、输入组件等，通过 C ABI 暴露给 TypeScript。React 绑定提供声明式组件模型。

## 3. 架构

### 3.1 启动流程

```text
main.ts
  ├─ startCore({ port, host, logger, sm })     → HTTP + WebSocket 服务启动
  └─ startTui({ url, serverInfo })              → OpenTUI 渲染器接管终端
       ├─ createCliRenderer({ screenMode: "alternate-screen" })
       ├─ createRoot(renderer).render(<App serverInfo={...} />)
       └─ renderer.start()
```

`startTui` 接收服务端运行时信息，通过 React props 向下传递。

### 3.2 组件树

```
<App serverInfo>
├─ <StatusBar />                          ← 固定 1 行，atom-neo + 运行状态
└─ <box flexDirection="row" flexGrow={1}> ← 主体：左右两栏
   ├─ <box flexGrow={1}>                  ← 左栏：对话区
   │  ├─ <ChatView />                     ←  ScrollBox(stickyScroll, bottom)
   │  └─ <InputBar />                     ←  固定高度 Input + 发送
   └─ <Sidebar serverInfo />             ←  右栏：信息面板（响应式）
```

### 3.3 数据流

```
WebSocket 事件               React State               UI 渲染
─────────────────         ────────────────         ───────────
transport.delta    ──→    messages[last]          → MarkdownRenderable
                              .streaming += text      (增量渲染)

tool.started       ──→    messages + [{            → ToolBubble
                              role:"tool",             (🔧 运行中...)
                              state:"running"
                           }]

tool.finished      ──→    更新 messages[last]      → ToolBubble
                              .state = "done"          (✓ 完成)

task.completed     ──→    messages[last]           → MarkdownRenderable
                              .streaming = false       (渲染完成)

task.failed        ──→    messages + [{            → ErrorBubble
                              role:"error",
                              content
                           }]
```

`useChat` hook 封装 WebSocket + HTTP，维护 `messages: Message[]` 状态和 `send(text: string)` 方法。

## 4. 布局规范

### 4.1 整体布局

```
┌──────────────────────────────────────┬────────────┐
│  atom-neo                    running │            │ ← StatusBar
├──────────────────────────────────────┼────────────┤
│                                      │ Server Info│
│  assistant: Hello, I'm...            │ Port: 3100 │
│                                      │ Host: 127..│
│  🔧 bash: ls -la          done ✓    │ Model: dsk │
│  ✓ file1  file2  file3              │ Sandbox: ~ │
│                                      │ Uptime: 2m │
│  user: What is the purpose of...     │            │
│                                      │ ────────── │
│  assistant: This project...          │ Tools:     │
│                                      │ • bash     │
│                                      │ • read     │
│                                      │ • write    │
│                                      │ • ls       │
│                                      │ • grep     │
│                                      │ • memory   │
│                                      │            │
├──────────────────────────────────────┤            │
│ ▸ Type your message...       [send]  │ v0.7.0     │ ← InputBar / Version
└──────────────────────────────────────┴────────────┘
```

### 4.2 响应式规则

| 终端宽度 | 右侧栏 | 说明 |
|----------|--------|------|
| `>= 90` 列 | 显示，固定宽度 24 列 | 完整布局 |
| `< 90` 列 | 隐藏 | 仅左栏全宽，保证对话体验 |

通过 `useTerminalDimensions()` hook 获取宽度，条件渲染 `<Sidebar>`。

### 4.3 尺寸规格

| 区域 | 尺寸 | 方式 |
|------|------|------|
| StatusBar | `height={1}` | 固定 |
| 主体 | `flexGrow={1}` | 占满剩余空间 |
| Sidebar | `width={24}` | 固定宽度 |
| ChatView | `flexGrow={1}` | 占满左栏剩余空间 |
| InputBar | `height={3}` | 固定 |

## 5. 组件规格

### 5.1 StatusBar

顶部单行状态栏。

```
atom-neo              ■ running
```

- 左侧: 应用名（青色加粗）
- 右侧: 运行状态指示（绿色圆点 + "running"）

```tsx
<box height={1} flexDirection="row" justifyContent="space-between" 
     backgroundColor="#1a3a5c" paddingLeft={1} paddingRight={1}>
  <text fg="#7dd3fc"><strong>atom-neo</strong></text>
  <text fg="#8BD5CA">■ running</text>
</box>
```

### 5.2 ChatView

可滚动的对话区域。核心行为：
- `stickyScroll={true}`, `stickyStart="bottom"` — 新消息自动滚底
- 用户手动上滚查看历史时，粘性暂停
- 滚回底部时恢复粘性

```tsx
<scrollbox flexGrow={1} stickyScroll stickyStart="bottom" padding={1}>
  {messages.map(msg => <MessageBubble key={msg.id} message={msg} />)}
</scrollbox>
```

### 5.3 MessageBubble

单条消息渲染，按消息角色区分样式：

| 角色 | 前缀 | 颜色 | 渲染方式 |
|------|------|------|---------|
| `user` | `▸` | 青色 `#7dd3fc` | 纯文本 |
| `assistant` | ` ` | 默认色 `#e2e8f0` | `MarkdownRenderable` (流式更新 `content`) |
| `tool` (running) | `🔧` | 黄色 `#fbbf24` | `Text` + spinner |
| `tool` (done) | `✓` | 绿色 `#8BD5CA` | `Text` + 结果摘要 |
| `tool` (error) | `✗` | 红色 `#ff7b72` | `Text` + 错误信息 |
| `error` | `✗` | 红色 `#ff7b72` | 纯文本 |

```tsx
function MessageBubble({ message }: { message: Message }) {
  if (message.role === "assistant") {
    return (
      <box paddingBottom={1}>
        <markdown 
          content={message.content} 
          streaming={message.streaming}
          syntaxStyle={MARKDOWN_STYLE}
        />
      </box>
    );
  }
  // ... user / tool / error variants
}
```

### 5.4 InputBar

底部输入区域。包含输入框和快捷键提示。

```
▸ Type your message...
  Tab: mode  •  Ctrl+C: exit
```

```tsx
<box height={3} borderStyle="single" flexDirection="row" paddingLeft={1}>
  <input 
    placeholder="▸ Type your message..."
    value={input}
    onInput={setInput}
    onSubmit={handleSend}
    focused
    flexGrow={1}
    backgroundColor="#1a1a1a"
    focusedBackgroundColor="#2a2a2a"
  />
</box>
```

提交时调用 `useChat().send(input)` 并清空输入框。

### 5.5 Sidebar

右侧信息面板。固定 24 列宽，仅当 `width >= 90` 时渲染。

```
┌────────────────────┐
│ Server Info        │
│                    │
│ Port: 3100         │
│ Host: 127.0.0.1    │
│ Model: deepseek    │
│ Sandbox: ~/proj    │
│ Uptime: 2m 15s     │
│                    │
│ ────────────────── │
│ Tools:             │
│   bash  read       │
│   write ls  grep   │
│   cp    mv  memory │
│                    │
│                    │
│ v0.7.0             │
└────────────────────┘
```

```tsx
<box width={24} borderStyle="single" padding={1} flexDirection="column">
  <text fg="#58A6FF"><strong>Server Info</strong></text>
  <text fg="#888"> </text>
  <text fg="#e2e8f0">Port: {serverInfo.port}</text>
  <text fg="#e2e8f0">Host: {serverInfo.host}</text>
  <text fg="#e2e8f0">Model: {serverInfo.model}</text>
  <text fg="#e2e8f0">Sandbox: {serverInfo.sandbox}</text>
  <text fg="#e2e8f0">Uptime: {uptime}</text>
  <text fg="#888"> </text>
  <text fg="#888">──────────────────</text>
  <text fg="#58A6FF"><strong>Tools:</strong></text>
  <text fg="#e2e8f0">{toolList}</text>
  <text flexGrow={1} />  {/* 弹性空白区推算版本号到底部 */}
  <text fg="#666">v{serverInfo.version}</text>
</box>
```

## 6. 类型定义

```typescript
// src/packages/tui/src/types.ts

type Message = 
  | { role: "user"; content: string; id: string }
  | { role: "assistant"; content: string; id: string; streaming: boolean }
  | { role: "tool"; toolName: string; state: "running" | "done" | "error"; 
      detail?: string; id: string }
  | { role: "error"; content: string; id: string };

interface ServerInfo {
  port: number;
  host: string;
  model: string;
  sandbox: string;
  version: string;
  tools: string[];
}
```

## 7. 文件结构

```
src/packages/tui/src/
├── app.tsx                    # 主入口: createCliRenderer → createRoot(<App/>)
├── components/
│   ├── App.tsx                # 根组件，布局编排
│   ├── StatusBar.tsx          # 顶部状态栏
│   ├── ChatView.tsx           # 左栏对话区 (ScrollBox + 消息列表)
│   ├── MessageBubble.tsx      # 单条消息渲染(用户/助手/工具/错误)
│   ├── InputBar.tsx           # 底部输入框
│   └── Sidebar.tsx            # 右栏信息面板(响应式)
├── hooks/
│   └── useChat.ts             # WebSocket + HTTP → messages state + send()
├── client/
│   └── ws-client.ts           # 保留，适配为 useChat 底层
├── types.ts                   # Message / ServerInfo 类型
└── index.ts                   # 导出 startTui
```

## 8. 集成点

### 8.1 main.ts 修改

```typescript
// 默认模式
if (!args.mode) {
  const core = await startCore({ port, host: args.host, logger, sm });
  const { startTui } = await import("@atom-neo/tui");
  await startTui({
    url: `http://${args.host}:${core.port}`,
    serverInfo: {
      port: core.port,
      host: args.host,
      model: resolved.model,
      sandbox: args.sandbox,
      version: "0.7.0",
      tools: basic.map(t => t.name),
    },
  });
  return;
}
```

### 8.2 startTui 签名变更

```typescript
export async function startTui(params: {
  url: string;
  sessionId?: string;
  serverInfo: ServerInfo;
}): Promise<void>
```

### 8.3 打包适配

`bun build --compile` 需要确保 OpenTUI React 插件能在编译后的二进制中正常运行。需要在入口处导入：

```typescript
import "@opentui/react/runtime-plugin-support"
```

## 9. 依赖

```json
{
  "@opentui/core": "latest",
  "@opentui/react": "latest",
  "react": "^19.0.0"
}
```

tsconfig 新增：
```json
{
  "jsx": "react-jsx",
  "jsxImportSource": "@opentui/react"
}
```
