# Sandbox Specification

> **Purpose**: 定义 Agent 的工作目录隔离规则和运行时数据管理。

---

## 1. 隔离规则

Agent 的**所有操作默认限定在 SANDBOX 目录内**：

- **允许**：在 SANDBOX 内读取、写入、执行任意操作
- **需要授权**：访问、改写 SANDBOX 外部的文件或目录（授权功能暂不实现，目前仅限 SANDBOX 内开发）
- **路径校验**：所有 Tool 操作的路径需确认未越界到 SANDBOX 外

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
| `.atom/memory.sqlite` | 长期记忆数据库（SQLite + FTS5） |
| `.atom/compiled_prompts/` | 缓存的编译后提示词 |

**规则**：除 `AGENTS.md` 和 `.env` 外，所有 Agent 运行时数据文件必须存储在 `.atom/` 下。

## 4. `AGENTS.md` — 项目指引文件

Agent 启动时检查 `SANDBOX/AGENTS.md` 是否存在：

1. **存在** → 加载到 SessionContext，作为 Agent 行为指引
2. **不存在** → 从模板文件 `src/assets/prompts/agents_md_sample.md` 复制一份到 SANDBOX

```typescript
// src/bootstrap/agents.ts
import agentsMdTemplate from "@assets/prompts/agents_md_sample.md";
import { existsSync, copyFileSync, mkdirSync } from "node:fs";

export function initAgentsMd(sandboxPath: string): void {
  const agentsPath = `${sandboxPath}/AGENTS.md`;
  if (!existsSync(agentsPath)) {
    mkdirSync(sandboxPath, { recursive: true });
    Bun.write(agentsPath, agentsMdTemplate);
  }
}
```

## 5. `.atom/` 初始化

```typescript
// 在启动序列中执行
export function initAtomDir(sandboxPath: string): void {
  const atomPath = `${sandboxPath}/.atom`;
  mkdirSync(atomPath, { recursive: true });
  mkdirSync(`${atomPath}/compiled_prompts`, { recursive: true });
}
```

## 6. 启动顺序（更新）

```text
src/main.ts
  ├── 1. parseArguments()                → BootArguments
  ├── 2. loadEnv(args.sandbox)            → .env → process.env
  ├── 3. loadConfig(args.sandbox)         → config.json
  ├── 4. createLogger(args)               → Logger
  ├── 5. initAtomDir(args.sandbox)        → 创建 .atom/
  ├── 6. initAgentsMd(args.sandbox)       → 检查/创建 AGENTS.md
  ├── 7. new RuntimeService({...})        → 统一环境入口
  ├── 8. sm.register("runtime", runtime)  → ServiceManager 管理
  └── 9. startCore({ port, host, logger, sm }) → HTTP 服务器
```

**v0.3.9 变化：** `setSandbox()` 已删除，sandbox 通过 `RuntimeService` 注入到工具工厂函数。

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

## 8. 相关文档

| 文档 | 说明 |
|------|------|
| [bootstrap.md](./bootstrap.md) | 启动序列 |
| [configuration.md](./configuration.md) | 配置加载 |
| [tool-plugin.md](./tool-plugin.md) | Tool 插件（沙箱路径校验） |
| [project-structure.md](./project-structure.md) | 项目目录结构 |
