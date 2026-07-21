# Builtin Tools

- `fs.ts` / `bash.ts`：Sandbox 文件与命令执行。
- `memory.ts`：Memory 搜索、读取、保存、关系与删除。
- `skill.ts`：Skill 发现与分段加载。
- `webfetch.ts`：受 ToolGuard 前置规则保护，将 Schema 输入转交同进程 NetworkService 的薄适配器。
- `history.ts`：仅访问当前 Session 的原始归档搜索与分页读取。
- `schedule.ts`：Hook/Schedule 管理。
- `intent.ts` / `todowrite.ts`：Agent 意图与 TODO 状态工具。
- `*.test.ts`：对应工具的输入、隔离、失败和输出边界测试。

所有工具通过 `ToolDefinition` 暴露，并在 `tools/bootstrap.ts` 统一创建。涉及路径或网络的工具
必须继续经过 ToolGuard；History Tool 不接收物理路径和 Session ID。
