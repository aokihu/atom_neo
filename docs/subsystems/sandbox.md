# Sandbox Specification

> **Purpose**: 定义 Agent 的工作目录隔离规则和运行时数据管理。

---

## 1. 隔离规则 (ToolGuard)

所有工具执行前经由 **ToolGuard** 统一安全检查，访问控制模型如下：

```
工具路径参数
  ├─ 黑名单（.atom）        → 拒绝，返回 "File not found"（对 Agent 完全隐藏）
  ├─ 沙箱目录内             → 允许
  └─ 沙箱目录外             → 检查 config.json permission.whitelist
       ├─ 在白名单中          → 允许
       └─ 不在白名单中        → 拒绝，返回 "Path is outside sandbox"
```

**ToolGuard 是 Proxy 拦截层**，包裹每个 `ToolDefinition.execute`，在以下三个时机介入：

| 阶段 | 检查内容 | 覆盖工具 |
|------|---------|---------|
| PRE (执行前) | 路径黑名单（.atom）+ 白名单 | read, write, ls, tree, grep, cp, mv |
| PRE (执行前) | bash 命令含 `.atom` 字串 | bash |
| POST (执行后) | 输出结果中移除 `.atom` 条目 | ls, tree, grep |

**bash 工具**额外受 `.atom` 命令字串检查限制，但对沙箱外路径不做白名单拦截（shell 命令解析复杂，后续增强）。

## 2. 目录结构

```
sandbox/                          # 工作目录（--sandbox 指定或默认 CWD）
├── config.json                   # 模型/TUI/Gateway 配置
├── .env                          # API Keys（gitignored）
├── AGENTS.md                     # 项目开发指引（Agent 行为规范）
├── .atom/                        # 【系统】Agent 运行时数据目录
│   ├── memory.sqlite            # 记忆数据库
│   └── compiled_prompts/        # 缓存的编译后提示词
└── ...                           # 用户项目文件
```

## 3. `.atom/` 目录

Agent **首次启动时**在 SANDBOX 下创建 `.atom/` 隐藏目录，用于存放所有运行时数据：

| 文件/目录 | 用途 |
|-----------|------|
| `.atom/installed` | **首次运行标记** — 空文件，存在表示已完成安装向导 |
| `.atom/memory/` | 记忆服务数据目录 |
| `.atom/memory/memory.db` | 长期记忆数据库（SQLite + FTS5） |
| `.atom/memory/nodes/` | 记忆节点存储（SHA256 命名） |
| `.atom/compiled_prompts/` | 缓存的编译后提示词 |
| `.atom/agents_meta.json` | 编译元数据追踪 |

**规则**：除 `AGENTS.md` 和 `.env` 外，所有 Agent 运行时数据文件必须存储在 `.atom/` 下。

### `.atom/installed` 标记文件

首次启动时，若 `$SANDBOX/.atom/installed` 不存在，进入 Ink 交互式安装向导。向导完成后创建此空文件作为「已安装」标记，后续启动直接跳过向导。

```typescript
// src/bootstrap/first-run.ts
export async function isFirstRun(sandboxPath: string): Promise<boolean> {
  return !(await Bun.file(`${sandboxPath}/.atom/installed`).exists());
}

export async function markInstalled(sandboxPath: string): Promise<void> {
  await Bun.write(`${sandboxPath}/.atom/installed`, "");
}
```

详见 [first-run-wizard.md](./first-run-wizard.md)。

## 4. `AGENTS.md` — 项目指引文件

Agent 启动时检查 `SANDBOX/AGENTS.md` 是否存在：

1. **存在** → 加载到 SessionContext，作为 Agent 行为指引
2. **不存在** → 从模板文件 `src/assets/prompts/agents_md_sample.md` 复制一份到 SANDBOX

```typescript
// src/bootstrap/agents.ts
import agentsMdTemplate from "@assets/prompts/agents_md_sample.md";

export async function initAgentsMd(sandboxPath: string): Promise<void> {
  const agentsPath = `${sandboxPath}/AGENTS.md`;
  if (!(await Bun.file(agentsPath).exists())) {
    // Bun.write 自动创建中间目录
    await Bun.write(agentsPath, agentsMdTemplate);
  }
}
```

## 5. `.atom/` 初始化

```typescript
// 在启动序列中执行
export async function initAtomDir(sandboxPath: string): Promise<void> {
  // Bun.write 自动创建中间目录
  await Bun.write(`${sandboxPath}/.atom/compiled_prompts/.gitkeep`, "");
}
```

## 6. 启动顺序（更新）

```text
src/main.ts
  ├── 1. parseArguments()                → BootArguments
  ├── 2. loadEnv(args.sandbox)            → .env → process.env
  ├── 3. loadConfig(args.sandbox)         → config.json
  ├── 4. createLogger(args)               → Logger
  ├── 5. isFirstRun(args.sandbox)         → 检查 .atom/installed
  │     ├─ 不存在 → runFirstRunWizard()   → Ink 交互向导
  │     └─ 已存在 → 跳过
  ├── 6. initAtomDir(args.sandbox)        → 创建 .atom/
  ├── 7. initAgentsMd(args.sandbox)       → 检查/创建 AGENTS.md
  ├── 8. new RuntimeService({...})        → 统一环境入口
  ├── 9. sm.register() + sm.startAll()    → ServiceManager 管理
  └── 10. startCore({ port, host, logger, sm }) → HTTP 服务器
```

首次启动时，若 `$SANDBOX/.atom/installed` 不存在，进入 Ink 交互式安装向导。向导完成后创建此空文件作为「已安装」标记，后续启动直接跳过向导。详见 [first-run-wizard.md](./first-run-wizard.md)。

## 7. 模板文件

`src/assets/prompts/agents_md_sample.md` — AGENTS.md 模板：

```markdown
# 项目开发指引

## 代码规范
- 遵循 "Less code, more power" 原则，代码精简干练
- 避免重复创建相似功能，复用已有代码
- 先思考后编写，禁止盲目编写

## 项目信息
<!-- 在此补充项目特定的开发指引 -->
```

## 8. ToolGuard 实现

ToolGuard 使用 Proxy 模式，在 `src/packages/core/src/tools/bootstrap.ts` 创建工具数组后统一包裹：

```typescript
// src/packages/core/src/tools/guard.ts
export function createToolGuard(
  tool: ToolDefinition,
  sandbox: string,
  whitelist: string[],
): ToolDefinition {
  return new Proxy(tool, {
    get(target, prop) {
      if (prop !== "execute") return Reflect.get(target, prop);
      return async (args: unknown) => {
        // PRE: 黑名单/白名单/bash命令检查
        const blocked = preCheck(target, args, sandbox, whitelist);
        if (blocked) return blocked;
        // EXEC: 原始工具执行
        const result = await target.execute(args);
        // POST: 输出过滤（ls/tree/grep 移除 .atom）
        return postFilter(target, result);
      };
    },
  });
}
```

### 决策表

| Agent 操作 | 拦截阶段 | 返回 |
|-----------|---------|------|
| `read .atom/x` | PRE 黑名单 | `"File not found"` |
| `ls .atom` | PRE 黑名单 | `"Directory not found"` |
| `read /etc/passwd` (未在白名单) | PRE 白名单 | `"Path is outside sandbox"` |
| `read /tmp/shared` (在白名单) | PRE 通过 | 正常执行 |
| `ls .` (沙箱根目录) | POST 过滤 | 结果中不含 `.atom` |
| `tree .` (沙箱根目录) | POST 过滤 | 树中不含 `.atom` 分支 |
| `grep "text" .` (沙箱根目录) | PRE 通过 + POST 过滤 | `.atom/` 内文件不参与搜索 |
| `bash "cat .atom/x"` | PRE bash 检查 | `"Command not allowed"` |
| `bash "cat /etc/passwd"` | PRE 通过 | 执行（后续增强） |
| `search_memory` / `save_memory` | 无路径参数，透传 | 正常执行 |

### 配置

```jsonc
// config.json
{
  "version": 2,
  "permission": {
    "whitelist": ["$HOME/Projects", "$SANDBOX/../shared", "/tmp/build"]
  }
}
```

### 路径别名

whitelist 和 Agent 路径参数支持以下别名自动解析：

| 别名 | 解析为 | 示例 |
|------|--------|------|
| `$HOME` | `os.homedir()` | `$HOME/Projects` → `/home/user/Projects` |
| `$SANDBOX` | 沙箱根目录 | `$SANDBOX/../shared` → 沙箱上级目录 |

别名在 ToolGuard PRE 检查时对 Agent 传入的路径同样生效，防止别名绕过。

whitelist 路径可以是绝对路径或相对路径（相对路径相对于沙箱根目录解析）。

## 9. 相关文档

| 文档 | 说明 |
|------|------|
| [bootstrap.md](../overview/bootstrap.md) | 启动序列 |
| [configuration.md](./configuration.md) | 配置加载 |
| [tool-plugin.md](./tool-plugin.md) | Tool 插件（沙箱路径校验） |
| [project-structure.md](../overview/project-structure.md) | 项目目录结构 |
