# Atom Neo — TUI Modal 组件

> **Purpose**: TUI 通用浮层组件 — 标题栏 + 自定义内容 + 统一 ActionBar，支持键盘导航、多种定位与锚点，用于确认框/对话框等场景。

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
| `placement` | `ModalPlacement` | 定位方式，默认 `center` |
| `anchorRect` | `ModalAnchorRect?` | `attach-*` 定位所需的锚点矩形 `{x,y,width,height}` |
| `actions` | `ModalAction[]` | 底部按钮列表，默认 `[]` |
| `defaultActionKey` | `string?` | 初始选中的按钮 `key` |
| `children` | `ReactNode?` | 自定义内容区 |
| `zIndex` | `number` | 层级，默认 `1000` |
| `onAction` | `(key, action) => void` | 触发某个按钮时回调 |
| `onClose` | `() => void` | Esc 关闭时回调 |

### `ModalAction`

| 属性 | 类型 | 说明 |
|------|------|------|
| `key` | `string` | 唯一标识，回调据此分发 |
| `label` | `string` | 显示文本 |
| `role` | `"confirm" \| "cancel" \| "destructive"` | 语义角色 |
| `variant` | `"normal" \| "primary" \| "danger"` | 视觉样式 |
| `disabled` | `boolean?` | 禁用，跳过选中与触发 |

## 定位 `ModalPlacement`

| 取值 | 行为 |
|------|------|
| `center` | 屏幕水平居中，垂直约 1/3 处（无锚点时） |
| `top` | 顶部 |
| `bottom` | 底部 |
| `attach-top` | 锚点上方（需 `anchorRect`） |
| `attach-bottom` | 锚点下方 |
| `attach-left` | 锚点左侧 |
| `attach-right` | 锚点右侧 |

> 第一版 `attach-*` 通过 `anchorRect` 的 `x/y/width/height` 直接计算，不做自动测量。

## 键盘交互

| 按键 | 行为 |
|------|------|
| `Esc` | 调用 `onClose`，关闭 Modal |
| `Enter` | 触发当前选中的 Action（`onAction`） |
| `Tab` / `→` | 选中下一个可用 Action（跳过 `disabled`） |
| `←` | 选中上一个可用 Action |

**焦点模型**：Modal 不依赖元素焦点，而是使用 `@opentui/react` 的全局 `useKeyboard` 钩子订阅按键。打开期间 `App` 给 `InputBar` 传入 `disabled`，使底部 `textarea` `focused={false}`，从而不抢按键、不响应提交。

初始选中项规则（`findInitialIndex`）：`defaultActionKey` → 首个 `confirm`/`primary` → 首个未禁用项。

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

- Modal 状态属 UI 状态，第一版放在 `App.tsx` 局部，**不进 chat store**。
- 复用现有 `theme.colors`，不引入新颜色体系。
- 不破坏既有 `/help`、`/compact`、命令菜单与输入历史行为。
- 仅在 `open` 时拦截按键；关闭后 `InputBar` 自动恢复焦点。
