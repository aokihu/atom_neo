# TUI Interface

> Atom Neo 的 OpenTUI 界面规范。视觉语言参考 eDEX-UI，但所有结构必须能够由终端字符网格稳定渲染。

## 1. 设计目标

定时任务栏显示当前 Core 的全部时间任务（跨 session），使用 /api/schedules 每 2 秒读取真实摘要：总数、启用数、名称、session/global 范围、等待/完成/过期/停用状态、下次执行时间。栏位位于右侧 Telemetry 栏，随右侧栏显示；内容可滚动，无任务显示空态，断连显示不可用，不保留看似实时的旧数据。独立 attach 与默认 TUI 行为一致，不显示任务 prompt。

定时任务 widget 位于右侧 Telemetry 栏的 CONTEXT 下方，复用其他模块的标题颜色、背景、对齐与间距，不添加独立背景或边框。左侧 SCHEDULES，右侧任务总数；下方保留 3 行内容空间，零任务只显示 EMPTY。中间区域只保留对话和输入。Compact 模式随右侧栏一起隐藏，不移回对话区。

- Conversation 始终是唯一的高对比主区域，视觉装饰不能挤压消息阅读空间。
- 使用等宽文字、字符单元背景色、细 Box Drawing 边框、Block Gauge 和 Braille/Sparkline 字符表达状态。
- 不使用渐变、阴影、透明层、图像、复杂曲线、微型字体或仅支持鼠标的交互。
- 所有指标来自当前 Session 的真实 Store 状态，不为了填满面板制造数据。
- 虚拟键盘不属于 Atom Neo；底部空间保留给消息输入和状态提示。

## 2. 视觉层级

左右侧栏内部模块统一无边框，使用相同的左右 1 列内边距和模块间 1 行留白。左侧 SESSION、PIPELINE、DECISION、STREAM、STATS 不增加左侧装饰线，仅保留侧栏与对话区之间的外侧分隔线。

所有 widget 的 EMPTY 使用统一空状态组件，文字颜色为当前主题 muted 文字与侧栏背景的 60% / 40% 混合，比模块标题更低对比度。覆盖 SCHEDULES、MCP、TODO 与 Runtime QUEUE；正常数据及错误状态保持原样。

1. 当前 Conversation、Tool execution 和 Command input。
2. 当前 Assistant response 与本轮历史消息。
3. 需要关注的 Runtime / Context / Tool / TODO 状态。
4. Uptime、累计数量和离线 Server 等被动信息。

Wide 模式使用背景 Block 和暗色空列形成区域分割，不使用贯穿全屏的高亮线框。
Runtime 与 Telemetry 的正文亮度约为 Conversation 的 `45% - 55%`；只有当前运行阶段、
Context 阈值、Tool error 和未完成 TODO 使用语义色。侧栏内部模块不使用边框；Tool execution
可使用一个字符单元宽的细边框。

## 3. 响应式布局

| 终端宽度 | 布局 | 内容 |
|---------|------|------|
| `>= 150` columns | Wide | Runtime + Conversation + Telemetry |
| `100 - 149` columns | Medium | Conversation + Telemetry |
| `< 100` columns | Compact | Conversation only |

```text
Wide
 ATOM NEO   CORE ONLINE   MODEL   THINKING                         VERSION

│ runtime       ▏  CONVERSATION                                    context
│ pipeline      ▏  user / assistant                                tools
│ activity      ▏  │ tool execution                                MCP
│ stats         ▏  │ command input                                 TODO / network

 ready                         shortcuts
```

侧栏是增强信息，不是主流程依赖。宽度不足时按 Runtime、Telemetry 的顺序隐藏，不能通过压缩字体或截断 Conversation 保留侧栏。

## 4. 面板职责

### Runtime

- `SESSION`：由 `busy` 显示 `ACTIVE` 或 `IDLE`。
- `UPTIME`：TUI 本地运行时长。
- `PIPELINE`：根据 preparing、Tool execution、Assistant streaming 推导当前可见阶段。
- `DECISION`：显示当前用户回合的 Prediction 与 Post-Conversation 判定。每项显示实际执行来源 `JEV` 或 `LLM`，以及 `RUN`、`OK`、`ERR` 状态；成功后分别显示 intent / modelProfile / topic 和分析状态。尚无事件时显示空状态。新用户回合清空旧结果，按 rootTaskId 忽略上一回合迟到事件。只显示预定字段，topic 在侧栏宽度内截断；不显示提示词、概率、密钥或错误原文。随 Runtime 侧栏一同在窄布局隐藏；重新连接后等待新事件，不回放历史判定。
- `STREAM`：统计 TUI 实际收到的 Reason / Text Delta 批次。最近 8 批按当前窗口
  最大估算 Token 数归一化为 8 级柱高；累计值使用 `≈` 标记，不能冒充 Provider
  最终返回的精确 Token usage。
- `STATS`：当前界面中真实存在的 Message、Tool success、Tool failure 数量。

### Conversation

- User 与 Assistant 消息显示角色和时间。
- Reasoning 默认折叠，键盘操作优先；鼠标只作为可选增强。
- Tool Group 执行中使用低亮度背景 Block、单字符细边框和单行
  `状态 / 名称 / 摘要`，不展示原始协议标记。
- Tool Group 完成后移除执行 Block，并聚合到同一 User Turn 最后一个可用的
  Thought 行：`THOUGHT 5s │ TOOLS 5/5 ▼`。点击 Tool 摘要或在其获得
  焦点后按 Enter，打开 Modal 查看每个 Tool 的状态、输入与结果摘要。
- 输入框保持固定高度；命令菜单继续覆盖在输入框上方。

### Telemetry

- `ROUNDS` 位于 CONTEXT 与 SCHEDULES 之间。标题右侧显示当前目标累计已用轮次 / 获准总额度，下方复用 Context 条形样式，第三行 `WINDOW` 显示局部已用轮次 / 局部限额。条形表示消耗而非任务完成度；达到 80% 显示警示色。健康检查显示 CHECKING；暂停显示 PAUSED 与简短原因，全局额度耗尽提示输入“继续”。无预算显示 EMPTY，断连显示 OFFLINE。
- 目标通过 Post 完成检查且没有未完成 TODO、暂停或待执行请求时，持久化完成标记。ROUNDS 与 WINDOW 的已用次数归零显示，指示条清空；实际累计次数保留在预算记录和日志中。暂停、检查失败、待用户输入及仅 TODO 全部完成均不等于目标完成，不触发归零。新一轮实际执行清除完成标记；重连保持完成后的显示。
- `TODO` 标题右侧用 `≡ 总数`，有进行中项目时改为 `▶ 位置 / 总数`。统计压缩为一行：`✅完成 ⌛待办 ▶进行中 ✕取消`，删除 PENDING、CANCELLED、NO ACTIVE ITEM 和独立快捷键提示行。渲染完整列表，超过 5 项启用 15 行高的滚动视口，保留文字换行与滚动条，支持鼠标滚轮及 Alt+Up/Down。最近新激活的 in_progress 项自动滚入可见范围；按真实布局定位，不能按项目序号估算换行高度。相同状态更新不打断手动浏览；布局尺寸变化时重新定位当前项。5 项及以下保持自然高度。
- Core 是预算与 TODO 状态的唯一权威。首次连接/重连携带 telemetry 快照，保存成功后推送更新；客户端不自行计数，失败的 todowrite 不改变计划。切换 Session 或断连清理旧状态。

- `CONTEXT`：`contextTokens / contextLimit`；Gauge 横向占满 Telemetry 的内部可用宽度。
- `TOOLS`：优先显示本轮 Tool 名称与状态；无本轮调用时退化为 Builtin / MCP 数量。
- `MCP`：真实 Server online 状态。
- `TODO`：当前 Session 的真实 Todo items。
- `NETWORK`：仅统计当前消息列表中的 `webfetch` 调用状态。

## 5. 颜色

默认 `edex` 主题使用近黑背景、分层背景 Block、低亮度蓝灰正文和淡青色细边框：

| 语义 | 颜色职责 |
|------|----------|
| Conversation heading / active focus | 淡青色 |
| Sidebar heading / passive metadata | 暗蓝灰 |
| Connected / success | 绿色 |
| Active / waiting | 琥珀色 |
| Error / failed | 红色 |
| Sidebar background | 接近 Page 的低对比深色 |
| Conversation background | 比 Sidebar 略亮的深蓝黑 |

其他主题保留自己的调色板，但共享同一套布局与信息层级。

## 6. 交互约束

- `/` 打开 Command Menu。
- `Enter` 发送，`Shift+Enter` 换行。
- `Up/Down` 浏览历史或命令。
- `Esc` 关闭菜单；Session busy 时双击 `Esc` 取消 Task。
- 面板折叠功能必须提供键盘路径，不能只绑定 `onMouseUp`。

## 7. 实现文件

```text
src/packages/tui/src/components/App.tsx
src/packages/tui/src/components/StatusBar.tsx
src/packages/tui/src/components/RuntimeSidebar.tsx
src/packages/tui/src/components/Sidebar.tsx
src/packages/tui/src/components/ToolMessageBox.tsx
src/packages/tui/src/components/InputBar.tsx
src/packages/tui/src/components/StatusLine.tsx
src/packages/tui/src/theme.ts
```
