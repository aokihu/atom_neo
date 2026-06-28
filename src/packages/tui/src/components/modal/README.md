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

- 键盘：`Esc` 关闭，`Enter` 触发选中项，`Tab`/`→` 下一项，`←` 上一项。
- 焦点：使用 `@opentui/react` 全局 `useKeyboard`（不依赖元素焦点）；打开时调用方应禁用 `InputBar` 焦点。
- 复用 `theme.colors`，不引入新颜色体系。
