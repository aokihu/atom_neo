# config-tui

统一 MenuApp 与配置向导 UI（OpenTUI）。由 `atom menu` / `atom config` / `atom config gateway` 启动，首次运行使用 `--wizard`，MenuApp Advanced 路由级复用 `WizardApp`。

## 模块

| 路径 | 职责 |
|---|---|
| `src/app.tsx` | 创建 Wizard renderer；注入 `GatewayInstanceActions`；首次运行取消与退出 |
| `src/menu/menu-app.tsx` | 统一 OpenTUI MenuApp；Home/Session/Gateway/Configure/Backup 路由、workspace、theme 与 Gateway port state |
| `src/menu/menu-routes.ts` | 路由类型与无配置时的 Workspace 重定向 |
| `src/menu/menu-home.tsx` | Home 菜单 |
| `src/menu/menu-frame.tsx` | 列表窗口滚动、状态头、路径省略、表单/secret/确认通用 UI |
| `src/menu/menu-types.ts` | `MenuActions` / `SessionSummary` / `MenuLaunch` 注入契约 |
| `src/menu/workspace-gate.tsx` | 顶级 Gateway 快捷入口的 workspace 确认（Enter / C / Esc） |
| `src/menu/session-view.tsx` / `history-view.tsx` / `core-server-view.tsx` | Session、History（删除确认/attached 保护）、Core Server |
| `src/menu/backup-view.tsx` | Export/Import 表单；遮罩密码、短密码拒绝、明文警告；复用 bootstrap backup actions |
| `src/menu/start-menu-app.tsx` | MenuApp renderer 生命周期与非 TTY 错误 |
| `src/wizard-logic.ts` | 配置文件读写、字段校验等纯逻辑入口 |
| `src/components/WizardApp.tsx` | reducer 编排、视图组合、保存流程 |
| `src/wizard/wizard-*` | wizard 状态、reducer、预填、编辑草稿 |
| `src/components/MenuModal.tsx` | 一级菜单（Providers/Profiles/Decisions/Theme/Gateway/Save） |
| `src/components/ProvidersModal.tsx` | provider 列表与新增 |
| `src/components/ApiKeyModal.tsx` | API Key 输入（只写入 `.env`） |
| `src/components/ModelsModal.tsx` | 模型、provider 类型、端点、thinking/contextLimit |
| `src/components/ProfilesModal.tsx` | 三档模型映射 |
| `src/components/DecisionsModal.tsx` | 判定模式与 Fast 模型 |
| `src/components/ThemeModal.tsx` | 主题选择 |
| `src/components/ProjectModal.tsx` | 项目描述（first-run） |
| `src/components/ConfirmModal.tsx` | 保存前确认 |
| `src/components/GatewayModal.tsx` | Gateway 实例列表、config-only 合并、supervisor 状态、诊断、start/stop/reload/register、install/load/pack、端口与编辑入口 |
| `src/components/GatewayInstanceForm.tsx` | `manifest.config` 驱动实例表单；编辑态保留已配置 secret |
| `src/components/SecretFieldInput.tsx` | 固定宽度 `••••••` 的单行 secret 输入；原始值只存在组件状态 |
| `src/gateway-instance-form.ts` | 表单字段/默认值/enum/secret 切分的纯逻辑 |
| `src/gateway-status.ts` | `listInstances` + supervisor 状态合并、admin API 状态/诊断/动作、`upsertInstance` 保存；config-only 标记 `configured/unregistered` |
| `src/modal/` | 固定 `chrome="bordered"` 的 Modal 包装 |
| `src/wizard/wizard-views` | 各视图的 props 装配，含 sandbox 与 CLI actions |

## 边界

- Gateway 进程状态只来自 supervisor/admin API；config-only 条目的 `registered:false` / `state:"unregistered"` 只表示配置存在，不是进程状态。平台检查只来自 Client `/diagnostics`，UI 不另建状态源。
- secret 永不渲染、不写日志/历史；列表只显示固定遮罩和字段名。
- Gateway 编辑保存走 `@atom-neo/shared` 的 `upsertInstance`，不直接写 `config.json`。
- install/load/pack 通过注入的 `GatewayInstanceActions` 复用 CLI handler，保持 cwd 与 file-lock 语义；`describe(id)` 读取目录/registry manifest 供 config-only 编辑，避免本包依赖 gateway。
- 本包不依赖 `@atom-neo/gateway`；只使用 shared 与 tui-kit。MenuApp 的动作通过 `MenuActions` 注入，不导入 bootstrap。
- MenuApp 与 WizardApp/GatewayModal 采用路由级复用；不复制 provider/model/theme/Gateway/backup 实现。
- `src/renderer-lifecycle.ts` 统一 MenuApp 与独立 Wizard 的 renderer 关闭/stream lease 等待；OpenTUI 尚未公开 native close promise，因此私有字段桥接只保留在该文件。

## 测试

```bash
bun test src/packages/config-tui/src
bun run --cwd src/packages/config-tui typecheck
```

重点：`menu/menu-app.test.tsx`（路由、theme/port 刷新、失败反馈、WorkspaceGate C、Wizard 返回与内部 Gateway 入口、Home 无 breadcrumb、64/40 列顶栏与深路径 breadcrumb）、`menu/menu-views.test.tsx`（长列表滚动、路径省略、History 删除确认键盘隔离/attached 保护、Core 启停）、`menu/menu-frame.test.ts`（`menuContentWidth` / `truncateByWidth` / `truncateMiddle` 的显示宽度、CJK、emoji、组合字符）、`menu/backup-view.test.tsx`（遮罩密码、短密码、明文警告、加密导入）、`gateway-instance-form.test.ts`（secret 遮罩/编辑/提交）、`gateway-status.test.ts`（admin 请求/诊断/保存）、`components/GatewayModal.test.tsx`（离线/列表/操作/重载错误/编辑）。
