# First-Run Wizard

> **Purpose**: 定义首次运行 Ink 交互式安装向导的完整行为规格。
> **Package**: `@atom-neo/setup-wizard` (`src/packages/setup-wizard/`)
> **启动方式**: 子进程（`Bun.spawn`），与主进程隔离

---

## 1. 架构概览

```
src/main.ts (主进程)
  │
  ├── 1-4. CLI → env → config → logger
  │
  ├── 5. isFirstRun(args.sandbox)
  │     ├─ .atom/installed 不存在 →
  │     │    spawnWizard(args.sandbox) → 自孵化子进程
  │     │    ├─ 开发模式: Bun.spawn([process.execPath, "run", import.meta.path, "--wizard", ...])
  │     │    └─ 编译模式: Bun.spawn([process.execPath, "--wizard", ...])
  │     │    ├─ exitCode 0 → 向导完成 → markInstalled() → 继续启动
  │     │    └─ exitCode ≠ 0 → 用户中止 → process.exit()
  │     └─ .atom/installed 已存在 → 跳过
  │
  └── 6-9. 现有启动流程继续
```

**设计原则**：
- SetupWizard 通过**自孵化（Self-Spawn）**子进程启动，拥有独立的 React/Ink 渲染器生命周期
- Bun 编译后的二进制内置完整 Bun 运行时，`process.execPath` 即是 Bun 运行时本身
- 与主进程的 OpenTUI 渲染器生命周期**完全隔离**，避免两个 React 渲染器冲突
- 通信方式为**文件系统**：向导写入 config.json / .env / AGENTS.md / .atom/installed，主进程通过退出码判断成功/失败

---

## 2. Package 结构

```
src/packages/setup-wizard/
├── package.json            # @atom-neo/setup-wizard
├── tsconfig.json
├── src/
│   ├── main.tsx            # 子进程入口：render(<SetupWizard />)
│   ├── components/
│   │   ├── SetupWizard.tsx   # 主控组件 (step 状态机)
│   │   ├── StepProvider.tsx  # Step 1: Provider 选择
│   │   ├── StepApiKey.tsx    # Step 2: API Key 输入
│   │   ├── StepModel.tsx     # Step 3: Model 档位选择
│   │   ├── StepTheme.tsx     # Step 4: TUI 主题选择
│   │   ├── StepProject.tsx   # Step 5: 项目描述 (可选)
│   │   └── StepConfirm.tsx   # Step 6: 确认总结与提交
│   └── types.ts
```

### 依赖

| 依赖 | 用途 |
|------|------|
| `ink` | React 终端渲染器 |
| `ink-text-input` | 单行文本输入，支持 `mask` 属性 |
| `ink-select-input` | 列表选择交互 |

```bash
cd src/packages/setup-wizard
bun add ink ink-text-input ink-select-input
```

---

## 3. 子进程启动

### 3.1 自孵化机制

Bun 编译后的二进制内置完整 Bun 运行时（JSC 引擎 + 所有标准库），因此二进制本身就可以作为子进程的运行时。关键原则：

```
开发模式: process.execPath = /path/to/bun
          → 需要 "run" 子命令指定入口文件
          → Bun.spawn([process.execPath, "run", import.meta.path, "--wizard", ...])

编译模式: process.execPath = /usr/local/bin/atom (二进制本身即是运行时)
          → 直接传 --wizard 参数即可
          → Bun.spawn([process.execPath, "--wizard", ...])
```

**模式检测**：编译后 `import.meta.path` 指向编译时的源码路径（目标机器上不存在），使用 `existsSync(import.meta.path)` 判断当前是开发还是编译模式。

### 3.2 主进程侧 (`src/bootstrap/first-run.ts`)

```typescript
import { existsSync, mkdirSync } from "node:fs";

export function isFirstRun(sandboxPath: string): boolean {
  return !existsSync(`${sandboxPath}/.atom/installed`);
}

export function markInstalled(sandboxPath: string): void {
  const installedPath = `${sandboxPath}/.atom/installed`;
  mkdirSync(`${sandboxPath}/.atom`, { recursive: true });
  Bun.write(installedPath, "");
}

function spawnWizard(sandboxPath: string): Bun.Subprocess {
  const isDev = existsSync(import.meta.path);

  if (isDev) {
    return Bun.spawn(
      [process.execPath, "run", import.meta.path, "--wizard", "--sandbox", sandboxPath],
      { stdio: ["inherit", "inherit", "inherit"] },
    );
  } else {
    return Bun.spawn(
      [process.execPath, "--wizard", "--sandbox", sandboxPath],
      { stdio: ["inherit", "inherit", "inherit"] },
    );
  }
}

export async function runFirstRunWizard(sandboxPath: string): Promise<void> {
  const proc = spawnWizard(sandboxPath);
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
```

**stdio 说明**：
- `["inherit", "inherit", "inherit"]` 将子进程的 stdin/stdout/stderr 直接继承父进程终端
- 这样 Ink 的渲染输出和用户键盘输入都能正常通过终端交互

### 3.3 主进程侧 (`src/main.ts` 集成)

```typescript
// src/main.ts — main() 函数中的变更部分

// ... 现有 1-4 步骤

// 5. First-Run Detection
if (isFirstRun(args.sandbox)) {
  await runFirstRunWizard(args.sandbox);
  markInstalled(args.sandbox);
  // 重新加载向导写入的配置
  loadEnv(args.sandbox);
  appConfig = loadConfig(args.sandbox);
  // ...
}

// 6-9 后续流程继续...
```

### 3.4 子进程侧 (`src/packages/setup-wizard/src/main.tsx`)

子进程入口由 `main.ts` 中的 `--wizard` 模式分支启动：

```typescript
// src/main.ts — 新增 --wizard 模式分支
export async function main(): Promise<void> {
  const parsed = parseArguments(Bun.argv.slice(2));
  // ...

  if (args.mode === "wizard") {
    await import("@atom-neo/setup-wizard");
    return;
  }

  // ... 正常启动流程
}
```

`setup-wizard/src/main.tsx` 作为 package 入口，直接运行 Ink：

```typescript
// src/packages/setup-wizard/src/main.tsx
import { parseArgs } from "node:util";
import React from "react";
import { render } from "ink";
import { SetupWizard } from "./components/SetupWizard";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: { sandbox: { type: "string" } },
});

const sandbox = values.sandbox as string;
if (!sandbox) {
  console.error("Usage: --sandbox <path>");
  process.exit(1);
}

const { unmount, waitUntilExit } = render(
  React.createElement(SetupWizard, {
    sandboxPath: sandbox,
    onComplete: () => unmount(),
    onAbort: () => { unmount(); process.exit(1); },
  }),
);

waitUntilExit().then(() => process.exit(0));
```

---

## 4. 组件架构

```
SetupWizard (主控组件, useReducer 管理状态)
├── StepProvider     — Step 0: Provider 选择 (ink-select-input)
├── StepApiKey       — Step 1: API Key 输入 (ink-text-input mask="*")
├── StepModel        — Step 2: Model 档位选择 (ink-select-input × 3)
├── StepTheme        — Step 3: TUI 主题选择 (ink-select-input)
├── StepProject      — Step 4: 项目描述 (ink-text-input 多行 / 可选跳过)
└── StepConfirm      — Step 5: 确认总结 → 写入文件 → unmount()
```

---

## 5. 步骤详细规格

### Step 0 — Provider 选择

```
╔═══════════════════════════════════════╗
║        Welcome to Atom Neo           ║
║        AI Agent Development Platform  ║
║                                       ║
║  Choose your LLM provider:            ║
║                                       ║
║  ● DeepSeek                           ║
║    OpenAI                             ║
║    Custom (OpenAI-compatible API)     ║
║                                       ║
║  ↑/↓ to navigate, Enter to select     ║
╚═══════════════════════════════════════╝
```

- 默认选中 DeepSeek
- 选择 DeepSeek → `apiKeyEnv = "DEEPSEEK_API_KEY"`, models: `["deepseek-v4-flash", "deepseek-v4-pro"]`
- 选择 OpenAI → `apiKeyEnv = "OPENAI_API_KEY"`, models: `["gpt-4o", "gpt-4o-mini"]`
- 选择 Custom → 额外要求输入 `baseUrl`，`apiKeyEnv` 和 `models` 由用户自定义

### Step 1 — API Key 输入

```
╔═══════════════════════════════════════╗
║  API Key Configuration                ║
║                                       ║
║  DeepSeek API Key:                    ║
║  sk-********************************  ║
║                                       ║
║  Your API key is stored in .env and   ║
║  never shared.                        ║
║                                       ║
║  Enter to continue                    ║
╚═══════════════════════════════════════╝
```

- `<TextInput mask="*" />` 安全输入
- **未输入 → Enter 不响应**，红色提示 `"API Key is required"`
- Custom 模式下额外要求输入自定义 `apiKeyEnv` 变量名

### Step 2 — Model 选择

```
╔═══════════════════════════════════════╗
║  Model Configuration                  ║
║                                       ║
║  Advanced (complex tasks):            ║
║  ● deepseek-v4-flash                      ║
║    deepseek-v4-pro                  ║
║                                       ║
║  Balanced (daily use):                ║
║  ● deepseek-v4-flash                      ║
║    deepseek-v4-pro                  ║
║                                       ║
║  Basic (quick tasks):                 ║
║  ● deepseek-v4-flash                      ║
║                                       ║
║  Tab to switch, Enter to confirm      ║
╚═══════════════════════════════════════╝
```

- 每个档位显示对应 Provider 的可用模型列表
- `Tab` 切换档位，`↑/↓` 切换模型
- 默认全部选中 Provider 的第一个模型

### Step 3 — TUI 主题选择

```
╔═══════════════════════════════════════╗
║  Theme Selection                      ║
║                                       ║
║  ● github-dark    ████████████████    ║
║    github-light   ░░░░░░░░░░░░░░░░    ║
║    dracula        ████▓▓▓▓▒▒▒▒░░░░    ║
║    nord           ▒▒▒▒▓▓▓▓████░░░░    ║
║    tokyo-night    ██▓▓▒▒░░██▓▓▒▒░░    ║
║    solarized-dark ██▓▓▓▓▒▒▒▒░░░░░░    ║
║    monokai        ████▓▓▓▓▓▓▓▓░░░░    ║
║                                       ║
║  ↑/↓ to preview, Enter to select      ║
╚═══════════════════════════════════════╝
```

- 默认 `github-dark`
- 右侧用 `<Text backgroundColor={...}>` 模拟色板预览

### Step 4 — 项目描述（可选）

```
╔═══════════════════════════════════════╗
║  Project Information (optional)        ║
║                                       ║
║  Describe your project:               ║
║  > A React web app...                 ║
║                                       ║
║  Written to AGENTS.md. Helps the      ║
║  agent understand your project.       ║
║                                       ║
║  Enter to continue, Esc to skip       ║
╚═══════════════════════════════════════╝
```

- 单行输入
- `Esc`：跳过，保留 AGENTS.md 模板内容
- `Enter`：保存并进入下一步

### Step 5 — 确认与提交

```
╔═══════════════════════════════════════╗
║  Configuration Summary                ║
║                                       ║
║  Provider:    DeepSeek                ║
║  API Key:     sk-****...****          ║
║  Advanced:    deepseek-v4-flash           ║
║  Balanced:    deepseek-v4-flash           ║
║  Basic:       deepseek-v4-flash           ║
║  Theme:       github-dark             ║
║  Project:     A React web app...      ║
║                                       ║
║  [ Confirm & Save ]                   ║
║                                       ║
║  Press Enter to confirm               ║
║  Press Esc to go back                 ║
╚═══════════════════════════════════════╝
```

- `Enter`：确认 → 批量写入文件 → `unmount()` → 子进程 exit(0)
- `Esc`：回到 Step 0 重新编辑

---

## 6. 文件写入规则

向导确认后按以下顺序写入，使用原子写入策略（先写临时文件再 rename）：

```typescript
// 在 onComplete 回调中执行
function commit(sandboxPath: string, state: WizardState): void {
  const sandbox = sandboxPath;

  // 1. 写入 config.json（合并到已有配置）
  const existingConfig = existsSync(`${sandbox}/config.json`)
    ? JSON.parse(readFileSync(`${sandbox}/config.json`, "utf-8"))
    : {};
  const merged = { version: 2, ...existingConfig, ...buildConfig(state) };
  Bun.write(`${sandbox}/config.json`, JSON.stringify(merged, null, 2));

  // 2. 追加 .env（不覆盖已有变量）
  const envLine = `${state.apiKeyEnv}=${state.apiKey}\n`;
  const existingEnv = existsSync(`${sandbox}/.env`)
    ? readFileSync(`${sandbox}/.env`, "utf-8")
    : "";
  // 仅追加，不覆盖已有同名变量
  if (!existingEnv.includes(`${state.apiKeyEnv}=`)) {
    Bun.write(`${sandbox}/.env`, envLine);
  } else {
    // 替换已有变量值
    const updated = existingEnv.replace(
      new RegExp(`^${state.apiKeyEnv}=.*`, "m"),
      `${state.apiKeyEnv}=${state.apiKey}`,
    );
    Bun.write(`${sandbox}/.env`, updated);
  }

  // 3. 写入 AGENTS.md（仅在用户提供了项目描述时）
  if (state.projectDescription) {
    Bun.write(`${sandbox}/AGENTS.md`, buildAgentsMd(state.projectDescription));
  }

  // 4. 创建 .atom/installed 标记
  mkdirSync(`${sandbox}/.atom`, { recursive: true });
  Bun.write(`${sandbox}/.atom/installed`, "");
}
```

---

## 7. 状态管理

```typescript
// src/packages/setup-wizard/src/types.ts

export interface WizardState {
  step: number;                 // 0-5
  provider: string;             // "deepseek" | "openai" | "custom"
  apiKeyEnv: string;            // env 变量名
  apiKey: string;               // 实际 key 值
  models: string[];             // Provider 可用模型列表
  customBaseUrl?: string;       // Custom provider 的 baseUrl
  profiles: {                   // 模型档位配置
    advanced: string;           // "deepseek/deepseek-v4-flash"
    balanced: string;
    basic: string;
  };
  theme: string;                // TUI theme 名称
  projectDescription: string;   // AGENTS.md 项目信息
}
```

---

## 8. 错误处理

| 场景 | 行为 |
|------|------|
| Step 1 未输入 API Key | Enter 不响应，红色提示 |
| 向导中途 `Ctrl+C` | Ink 退出，子进程 exit(1)，主进程 exit(1) |
| 子进程崩溃 | 主进程打印错误，不创建 `.atom/installed` |
| `config.json` 已存在 | 合并写入（不覆盖手动修改的字段） |
| `.env` 已有其他变量 | 仅追加/更新目标 API Key 变量 |
| sandbox 路径无写入权限 | 向导提示错误，退出 |

---

## 9. workspace 集成

```jsonc
// src/packages/setup-wizard/package.json
{
  "name": "@atom-neo/setup-wizard",
  "version": "0.1.0",
  "private": true,
  "main": "src/main.tsx",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "setup": "bun run src/main.tsx"
  },
  "dependencies": {
    "ink": "^5.x",
    "ink-text-input": "^6.x",
    "ink-select-input": "^5.x",
    "react": "^19.x"
  }
}
```

根 `package.json` 补充 workspace：
```json
"workspaces": [
  "src/packages/shared",
  "src/packages/core",
  "src/packages/setup-wizard",  // 新增
  "src/packages/gateway",
  "src/packages/tui"
]
```
