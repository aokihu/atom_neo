# modal/ — TUI 通用浮层组件

可复用的 Modal 浮层：标题栏 + 自定义内容 + 统一底部 ActionBar，支持键盘导航与多种定位。独立于 chat store，UI 状态由调用方局部持有。

完整设计与 API 见 [docs/tui-modal.md](../../../../../../docs/tui-modal.md)。

## 文件

| 文件 | 职责 |
|------|------|
| `types.ts` | 类型定义：`ModalProps` / `ModalAction` / `ModalPlacement` / `ModalAnchorRect` 等 |
| `Modal.tsx` | 主组件：定位计算、全局 `useKeyboard` 键盘订阅、绝对定位布局 |
| `ModalActionBar.tsx` | 底部按钮条，按 `selectedIndex` 高亮，按 `role`/`variant` 着色 |
| `index.ts` | 统一导出入口 |

## 关键约定

- 两种模式：默认 **ActionBar 模式**（确认框，Tab/←/→ 切按钮，Enter 触发）；传入 `listLength` 启用 **列表模式**（↑/↓ 导航，Enter 激活，配合 `selectedListIndex`/`onListNavigate`/`onListActivate`）。
- 定位：无 `anchorRect` 时按 `placement`（`center`/`top`/`bottom`）相对屏幕；提供 `anchorRect` 时用「两参考点对齐」—— Modal 的 `position` 点贴到锚点对象的 `anchorPosition` 点（9 点：`top-left`…`bottom-right`），再叠加 `offset` 间距；`matchAnchorWidth` 令面板与锚点等宽。
- 键盘：`Esc` 关闭，`Enter` 触发选中项，`Tab`/`→` 下一项，`←` 上一项；列表模式下 `↑`/`↓` 切换、`Enter` 激活。
- 焦点：使用 `@opentui/react` 全局 `useKeyboard`（不依赖元素焦点）；打开时调用方应禁用 `InputBar` 焦点。
- 复用 `theme.colors`，不引入新颜色体系。
- 命令面板见 `../CommandPalette.tsx`（基于列表模式 + 锚点对齐构建：锚到输入框、覆盖、满宽）。
