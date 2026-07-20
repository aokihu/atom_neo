# Core Tools

| 文件 | 职责 |
|---|---|
| `bootstrap.ts` | 创建 Builtin Tool，并套用 ToolGuard |
| `registry.ts` | 注册和查询 ToolDefinition |
| `guard.ts` | 执行前动态策略、沙箱路径检查和结果过滤 |
| `governance.ts` | 单次 AI SDK 工具循环的判重、无进展计数与调用预算 |
| `permissions.ts` | 按 PermissionLevel 过滤 ToolDefinition |
| `executor.ts` | 在指定 PermissionLevel 下直接执行 Tool |
| `mcp-manager.ts` | MCP 连接、工具发现与健康检查 |
| `schedule-service.ts` | 定时任务生命周期 |
| `builtin/` | Builtin Tool 实现；详见 `builtin/README.md` |

`ToolCallLedger` 只管理一次 `streamText()` 内的执行行为。WebFetch 的 URL、页面质量与
正文信息增量由后续专项策略处理，不进入通用治理层。
