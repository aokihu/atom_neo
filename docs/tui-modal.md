# Atom Neo — TUI Modal 组件

> **Purpose**: TUI 通用浮层组件 — 标题栏 + 自定义内容 + 统一 ActionBar，支持键盘导航、屏幕定位、以及基于锚点对象的「两参考点」对齐定位，用于确认框/对话框/命令面板等场景。

---

## 概览

`Modal` 是位于 `src/packages/tui/src/components/modal/` 的可复用浮层组件，独立于 chat store，UI 状态由调用方（当前为 `App.tsx`）局部持有。它在屏幕上以绝对定位覆盖整个终端区域，并通过全局键盘订阅接管按键，打开期间底部 `InputBar` 释放焦点。

```
┌──────────────────────────────────────────────┐  ← 全屏 overlay (zIndex 1000)
│                                                │
│        ┌────────────────────────────┐          │
│        │ Title                       │ ← title  │
│        ├────────────────────────────┤          │
│        │ children ...               │ ← content│
│        │                            │          │
│        ├────────────────────────────┤          │
│        │            Cancel   [ OK ] │ ← ActionBar
│        └────────────────────────────┘          │
│                                                │
└──────────────────────────────────────────────┘
```

## 组件构成

| 文件 | 职责 |
|------|------|
| `types.ts` | 类型定义：`ModalProps` / `ModalAction` / `ModalPlacement` 等 |
| `Modal.tsx` | 主组件：定位计算、键盘订阅、布局渲染 |
| `ModalActionBar.tsx` | 底部按钮条，按 `selectedIndex` 高亮当前选项 |
| `index.ts` | 统一导出入口 |

## API — `ModalProps`

| 属性 | 类型 | 说明 |
|------|------|------|
| `open` | `boolean` | 是否显示，`false` 时返回 `null` |
| `title` | `string?` | 标题栏文本，省略则不渲染标题栏 |
| `width` | `number` | 宽度，默认 `60`，自动夹紧到 `[20, screenWidth-4]` |
| `height` | `number?` | 高度，省略则按内容自适应 |
| `placement` | `ModalPlacement` | 无锚点时的屏幕定位，默认 `center`（`center`/`top`/`bottom`） |
| `anchorRect` | `ModalAnchorRect?` | **锚点对象**矩形 `{x,y,width,height}`（屏幕坐标）。提供后启用两参考点对齐定位 |
| `anchorPosition` | `ModalAnchorPoint?` | 锚点对象**上**的参考点（9 点之一），默认 `bottom-left` |
| `position` | `ModalAnchorPoint?` | Modal **自身**用于贴合锚点的参考点（9 点之一），默认 `top-left` |
| `offset` | `{ x?: number; y?: number }?` | 间距：在对齐点基础上偏移 Modal（`x` 正右、`y` 正下），默认 `{0,0}` |
| `matchAnchorWidth` | `boolean?` | 令 `Modal.width = anchorRect.width`（与锚点等宽，如命令面板满输入框宽） |
| `actions` | `ModalAction[]` | 底部按钮列表，默认 `[]` |
| `defaultActionKey` | `string?` | 初始选中的按钮 `key` |
| `children` | `ReactNode?` | 自定义内容区 |
| `zIndex` | `number` | 层级，默认 `1000` |
| `onAction` | `(key, action) => void` | 触发某个按钮时回调 |
| `onClose` | `() => void` | Esc 关闭时回调 |
| `listLength` | `number?` | 列表模式：可选项数量，提供后启用 ↑/↓/Enter 列表导航 |
| `selectedListIndex` | `number?` | 列表模式：当前选中项下标（受控，默认 `0`） |
| `onListNavigate` | `(index) => void` | 列表模式：↑/↓ 导航回调（已自动环绕） |
| `onListActivate` | `(index) => void` | 列表模式：Enter 激活当前项回调 |

### `ModalAction`

| 属性 | 类型 | 说明 |
|------|------|------|
| `key` | `string` | 唯一标识，回调据此分发 |
| `label` | `string` | 显示文本 |
| `role` | `"confirm" \| "cancel" \| "destructive"` | 语义角色 |
| `variant` | `"normal" \| "primary" \| "danger"` | 视觉样式 |
| `disabled` | `boolean?` | 禁用，跳过选中与触发 |

## 定位

### 无锚点：`placement`（屏幕相对）

未提供 `anchorRect` 时，按 `placement` 相对屏幕定位（确认框/对话框用）：

| 取值 | 行为 |
|------|------|
| `center` | 屏幕水平居中，垂直约 1/3 处 |
| `top` | 顶部 |
| `bottom` | 底部 |

### 有锚点：两参考点对齐（`anchorRect` + `anchorPosition` + `position`）

提供 `anchorRect`（锚点对象矩形，屏幕坐标）后启用：Modal 的 `position` 参考点 **重合** 到锚点对象的 `anchorPosition` 参考点上；再叠加 `offset` 间距。这与 CSS Anchor Positioning / floating-ui 的模型一致。

**9 个参考点 `ModalAnchorPoint`**（`anchorPosition` 与 `position` 共用）：

```
   top-left ──── top ──── top-right
       │                      │
     left       center      right
       │                      │
 bottom-left ── bottom ── bottom-right
```

**对齐公式**（屏幕坐标，`f.h ∈ {0,.5,1}` 左/中/右，`f.v ∈ {0,.5,1}` 上/中/下）：

```
锚点目标点  ax = anchor.x + f.h(anchorPosition) * anchor.width  + offset.x
           ay = anchor.y + f.v(anchorPosition) * anchor.height + offset.y
Modal 用 position 的参考点贴到 (ax, ay)：
  position 左→设 left，右→设 right，中→ left = ax - W/2
  position 上→设 top， 下→设 bottom，中→ top  = ay - H/2
```

> 用 `right`/`bottom` 锚定时无需已知 Modal 宽/高（可自适应内容向左/上生长）；`matchAnchorWidth` 时 `W = anchor.width`。

**示例（命令面板：覆盖在底部输入区、左对齐、满输入框宽）**

- `anchorObject = UserInput`，`anchorPosition = "bottom-left"`，`position = "bottom-left"`，`matchAnchorWidth`

```
 ┌───────────────────────────┐
 │ Commands                  │  ← Modal 向上生长
 │  ▸ /clear                 │
 │    /quit                  │
 ●═══════════════════════════╝  ● = 两者的 bottom-left 点重合
 ║ > type a message...       ║  ← UserInput（被覆盖，打开期间失焦）
 ╚═══════════════════════════╝
```

## 键盘交互

Modal 有两种交互模式，由是否传入 `listLength` 决定：

**ActionBar 模式（默认，确认框/对话框）**

| 按键 | 行为 |
|------|------|
| `Esc` | 调用 `onClose`，关闭 Modal |
| `Enter` | 触发当前选中的 Action（`onAction`） |
| `Tab` / `→` | 选中下一个可用 Action（跳过 `disabled`） |
| `←` | 选中上一个可用 Action |

**列表模式（传入 `listLength` 时，命令面板等）**

| 按键 | 行为 |
|------|------|
| `Esc` | 调用 `onClose` |
| `↑` / `↓` | `onListNavigate(下标)`，自动环绕 |
| `Enter` | `onListActivate(当前下标)` |

> 列表模式优先于 ActionBar：传入 `listLength` 后 ↑/↓/Enter 走列表回调；此时通常不再传 `actions`。

**焦点模型**：Modal 不依赖元素焦点，而是使用 `@opentui/react` 的全局 `useKeyboard` 钩子订阅按键。打开期间 `App` 给 `InputBar` 传入 `disabled`，使底部 `textarea` `focused={false}`，从而不抢按键、不响应提交。

初始选中项规则（`findInitialIndex`，仅 ActionBar 模式）：`defaultActionKey` → 首个 `confirm`/`primary` → 首个未禁用项。

## 命令面板（Command Palette）

`CommandPalette`（`src/packages/tui/src/components/CommandPalette.tsx`）是基于 Modal **列表模式**构建的独立命令面板，替代旧的内联下拉菜单。

**交互流程**：

1. 用户在 `InputBar` 输入首字符 `/`，`InputBar` 调用 `onOpenPalette(seed)` 并清空输入框。
2. `App` 持有 `paletteOpen` / `paletteSeed` 状态，在根节点渲染 `CommandPalette`，同时把 `InputBar` 置为 `disabled`（`textarea` 失焦）。
3. **锚点定位**：`App` 用 `anchorRef`（指向 `InputBar` 内层输入框 box）作为锚点对象，`CommandPalette` 经 `el.screenX/screenY/width/height` 测得其屏幕矩形（首次打开 + 终端 `useOnResize` 重测），以 `anchorPosition="bottom-left"` / `position="bottom-left"` / `matchAnchorWidth` 传给 `Modal` —— 面板覆盖在输入框上、左对齐、满输入框宽。
4. 面板内：
   - **过滤**：`CommandPalette` 自身用全局 `useKeyboard` 收集可打印字符与 `Backspace`，构建 `filter`（无独立输入框元素，避免焦点争用）。
   - **导航/执行/关闭**：交给 Modal 列表模式 —— `↑/↓` 切换、`Enter` 执行、`Esc` 关闭。
5. 选中命令后 `onRun(cmd)` 由 `App` 分发到对应处理器（`/clear`、`/quit` 打开确认框；`/help`、`/compact` 直接执行），随后关闭面板，`InputBar` 恢复焦点。

> 列表渲染复用既有 `CommandMenu`（高亮匹配子串 + 描述列）；过滤逻辑复用 `matchCommands`。两个全局 `useKeyboard`（面板过滤 vs Modal 导航）处理**互不相交**的按键，无冲突。

## 使用示例

`App.tsx` 中以局部 `useState` 持有 Modal 状态（不进 chat store），`/clear` 与退出改为确认框：

```tsx
const [activeModal, setActiveModal] = useState<ActiveModal>(null);
const modalActions: ModalAction[] = [
  { key: "cancel", label: "Cancel", role: "cancel" },
  { key: "ok", label: "OK", role: "confirm", variant: "primary" },
];

<InputBar /* ... */ onQuit={handleQuit} disabled={activeModal !== null} />

{activeModal && (
  <Modal
    open
    title={activeModal.kind === "confirm-clear" ? "Clear conversation?" : "Exit Atom Neo?"}
    placement="center"
    width={56}
    actions={modalActions}
    defaultActionKey="cancel"
    onClose={closeModal}
    onAction={(key) => { /* cancel / clearMessages / onQuit */ }}
  >
    <text>...</text>
  </Modal>
)}
```

## 设计约束

- Modal 状态属 UI 状态，放在 `App.tsx` 局部，**不进 chat store**。
- **布局间距以 1 个单位为基准**：面板底部/两侧内边距为 1、`paddingTop={0}`（标题贴紧顶部边框）；标题用底部分隔线紧贴文字，内容无额外内边距，避免间距叠加。
- 复用现有 `theme.colors`，不引入新颜色体系。
- 命令面板复用 `CommandMenu` 渲染与 `matchCommands` 过滤；`/help`、`/compact` 行为保持不变。
- 仅在 `open` 时拦截按键；关闭后 `InputBar` 自动恢复焦点。
