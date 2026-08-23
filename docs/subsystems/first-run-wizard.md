# First-Run Wizard & Config TUI

> **Purpose**: 首次运行向导与 `--config` 配置编辑器的完整行为规格（OpenTUI 窗口化界面）。
> **Package**: `@atom-neo/config-tui` (`src/packages/config-tui/`)
> **启动方式**: 子进程（`Bun.spawn`）或独立进程入口，与主进程隔离

---

## 1. 架构概览

```
src/main.ts (主进程)
  │
  ├── 1-4. CLI → env → config → logger
  │
  ├── 1.5 Early exits
  │     ├─ --wizard → startWizard(sandbox, "first-run") → return
  │     └─ --config → startWizard(sandbox, "config") → return
  │
  ├── 5. isFirstRun(args.sandbox)
  │     ├─ .atom/installed 不存在 → spawnWizard() → 自孵化子进程 (--wizard)
  │     └─ .atom/installed 已存在 → 跳过
  │
  └── 6-9. 现有启动流程继续
```

**设计原则**：

- `@atom-neo/config-tui` 是**独立包**：OpenTUI 渲染器、Modal 组件、主题全部自持，不 import `@atom-neo/tui` 的任何代码；包职责明确（聊天 UI 与向导 UI 分离）
- 与主进程的 OpenTUI 渲染器生命周期完全隔离，避免两个渲染器冲突
- 通信方式为**文件系统**：向导写入 config.json / .env / AGENTS.md / .atom/installed，主进程通过退出码判断成功/失败
- 两种模式共用同一套 Modal 组件与状态逻辑，仅导航编排不同

---

## 2. Package 结构

```
src/packages/config-tui/
├── package.json            # @atom-neo/config-tui
├── tsconfig.json
└── src/
    ├── index.ts            # export { startWizard }
    ├── app.tsx             # startWizard：渲染器生命周期 + Ctrl+C/D(EOF) 退出语义
    ├── wizard-logic.ts     # 单一文件：types + pending 状态机 + commit + load + 解析器
    ├── wizard-logic.test.ts
    ├── theme.tsx           # 自持主题（8 套配色 + ThemeProvider/useTheme）
    ├── modal/              # 自持 Modal 原语（列表导航 + 操作栏 + Esc 关闭）
    │   ├── Modal.tsx
    │   ├── ModalActionBar.tsx
    │   ├── types.ts
    │   └── index.ts
    └── components/
        ├── WizardApp.tsx      # 编排：状态机 + 视图栈 + 退出确认（纯色背景）
        ├── FieldInput.tsx     # Modal 内单行表单输入（Enter 提交 / Esc 取消）
        ├── MenuModal.tsx      # 一级菜单：左详情 + 右列表（describeSelection 纯函数）
        ├── ProvidersModal.tsx # provider 列表 + 新增
        ├── ApiKeyModal.tsx    # API Key（明文，仅写入 .env）
        ├── ModelsModal.tsx    # 模型增删 + baseUrl + thinking + contextLimit
        ├── ProfilesModal.tsx  # 三档映射 + 模型选择子弹窗
        ├── ThemeModal.tsx
        ├── GatewayModal.tsx   # 端口编辑
        ├── ProjectModal.tsx   # 项目描述（仅 first-run）
        └── ConfirmModal.tsx   # 摘要确认
```

### 依赖

| 依赖 | 用途 |
|------|------|
| `@opentui/core` / `@opentui/react` | 终端渲染与 React 绑定 |
| `react` | 组件 |

---

## 3. 窗口化界面（Windows 风格）

```
（纯色背景，随当前主题变化）
        ╭───────────── CONFIGURATION ──────────────╮
        │ ┌───────┐ ┌─ Providers (1) ────────────┐ │
        │ │▸Providers (1)│ │ deepseek             │ │
        │ │ Model Profiles│ │   models: v4-pro,   │ │
        │ │ Theme (edex)│ │           v4-flash    │ │
        │ │ Gateway (port)│ │   thinking: enabled │ │
        │ │ Save & Exit│ │                        │ │
        │ └───────┘ └────────────────────────────┘ │
        ├──────────────────────────────────────────┤
        │ ↑/↓ select · Enter open · Esc quit       │
        ╰──────────────────────────────────────────╯
```

- **左栏（50%）**：垂直平铺一级菜单（5 项）
- **右栏（50%）**：设置数据详情，随左栏菜单选中项实时变化（providers 逐项列出 models/thinking；三档映射；当前主题；网关端口；保存目标说明）
- Modal 宽度为加宽版（96 列），左右比例 1:1；仅保留中央 Modal，背景为纯色页面

**键位约定**：

| 键 | 行为 |
|----|------|
| ↑/↓ | 列表导航 |
| Enter | 选中 / 打开 / 确认 / 提交表单 |
| Tab / ←/→ | 操作栏按钮间移动（带操作栏的 Modal） |
| `d` | ModelsModal 列表内删除高亮模型 |
| Esc | 逐层关闭：子弹窗 → 表单回退 → 当前 Modal → 主菜单层弹「退出不保存?」确认 |
| Ctrl+C / Ctrl+D / EOF | 中止（first-run 退出码 1；config 退出码 0） |

**表单 Modal**：`interactive={false}` 关闭 Modal 全局按键，由内部 `FieldInput`（textarea）接管 Enter/Esc，避免按键双触发。

---

## 4. 步骤流程（first-run 模式）

线性 Modal 链：

```text
ProvidersModal（deepseek / openai / custom）
  → ApiKeyModal（API Key；custom 附加 Env Var 与 Base URL）
    → ModelsModal（模型列表 + baseUrl + thinking + contextLimit）
      → ProfilesModal（三档映射，Enter 打开模型选择子弹窗）
        → ThemeModal
          → ProjectModal（可选，写入 AGENTS.md）
            → ConfirmModal → commit → 退出
```

Esc 逐层回退；根层 Esc 弹退出确认。

---

## 5. 步骤流程（config 模式）

平铺一级菜单（`MenuModal`），选择节次进入编辑，完成后返回菜单：

```text
MenuModal
  ├─ Providers (N)     → ProvidersModal → ApiKeyModal → ModelsModal → finalize → 返回 Provider 列表
  ├─ Model Profiles    → ProfilesModal（选项 = 所有 provider 实际模型；预填）
  ├─ Theme (edex)      → ThemeModal（预填）
  ├─ Gateway (port)    → GatewayModal（仅端口；clients 手动编辑 config.json）
  └─ Save & Exit       → ConfirmModal → commit
Esc（菜单层）→ 退出确认
```

ProjectModal 在 config 模式跳过（不重写 AGENTS.md）。

### 预填规则

| 字段 | 来源 |
|------|------|
| provider 列表 | `config.providers` 的 keys（为空时展示 deepseek/openai/custom） |
| models / baseUrl / thinking / contextLimit | `config.providers[x]` 对应字段 |
| apiKey | `.env` 中 `providers[x].apiKeyEnv` 对应行 |
| profiles | `config.providerProfiles` |
| theme | `config.tui.theme` |
| gatewayPort | `config.gateway.port` |

读取全部为宽松解析（JSON.parse 容忍缺字段），未知字段原样保留。

---

## 6. 写盘规则

| 对象 | first-run | config |
|------|-----------|--------|
| config.json | 合并，按 provider 合并写入 | 按 provider 合并（保留其他 provider 与未编辑字段）+ 更新 `gateway.port`（clients 保留） |
| .env | 新增/替换 `apiKeyEnv` 行 | 同左；删除 provider 时保留旧 key 不误删 |
| AGENTS.md | 有项目描述则写入 | 不写入 |
| .atom/installed | 写入 | 不写入 |
| .atom/runtime-config.json | 不触碰 | 不触碰（运行时 overlay 保持独立） |

---

## 7. 编辑原子性与取消回滚

Provider 编辑采用 **pending 快照** 机制（`wizard-logic.ts`）：

```text
Providers 选择/新增 provider
  └─ beginEdit / beginNewProvider → 创建 pending 快照（不写入 editedProviders）
       ├─ ApiKeyModal 提交 → 更新 pending（含 apiKeyEnv/apiKey）
       ├─ ModelsModal 提交 → finalizeEdit 校验通过后落入 editedProviders
       │     └─ 校验失败（models 为空）→ 拒绝 finalize，保持 pending
       └─ 中途 Esc 取消 → 丢弃 pending（原子回滚），editedProviders 与 .env 均不变
```

**提交层双保险**（`commit`）：`models` 为空的 edit 直接跳过；`apiKeyEnv` 为空时写入 `""` 而非 `undefined`（避免 JSON 序列化丢字段）。

**加载层恢复**（`bootstrap/config.ts`）：config.json 中历史遗留的无效 provider 条目会被丢弃、其余配置保留，而非整体回退默认值。

---

## 8. 状态管理

`wizard-logic.ts`（单一文件）承载全部纯逻辑：

```typescript
// 核心类型
export type WizardMode = "first-run" | "config";
export interface WizardState { step; mode; provider; apiKeyEnv; apiKey; models;
  customBaseUrl?; thinking; contextLimit?; profiles; theme; gatewayPort;
  projectDescription; editedProviders; envKeys; }
export type PendingEdit = { id: string; isNew: boolean; edit: ProviderEdit };

// pending 状态机
beginEdit(state, id) / beginNewProvider(state, id) / updatePendingApiKey(...) / finalizeEdit(...)

// 文件 IO
buildInitialState(mode, sandbox)  // 预填
commit(sandbox, state)            // 合并写盘 + .env upsert
readEnvKeys / writeEnvKeys / readJsonFile

// 解析器
addModel / removeModelAt / parseContextLimit / parsePort / collectModelIds
```

---

## 9. 错误处理

| 场景 | 行为 |
|------|------|
| API Key 为空 | 红色提示，停留原表单 |
| Models 为空时 finalize | 拒绝并提示「至少一个模型」 |
| 端口/contextLimit 非法 | 红色提示，不提交 |
| 向导中途 `Ctrl+C` / `Ctrl+D` / EOF | first-run：子进程 exit(1)；config：exit(0) 不保存 |
| config.json 已存在 | 合并写入（不覆盖手动修改的字段） |
| `.env` 已有其他变量 | 仅追加/更新目标 API Key 变量 |

---

## 10. workspace 集成

```jsonc
// src/packages/config-tui/package.json
{
  "name": "@atom-neo/config-tui",
  "version": "1.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": { "typecheck": "tsc --noEmit", "build": "tsc" },
  "dependencies": {
    "@opentui/core": "0.4.3",
    "@opentui/react": "0.4.3",
    "react": "^19.2.6"
  }
}
```

根 `package.json` workspace：`"src/packages/config-tui"`（取代已删除的 `src/packages/setup-wizard`，Ink 依赖整体移除）。

## 相关文档

| 文档 | 说明 |
|------|------|
| [bootstrap.md](../overview/bootstrap.md) | 启动序列中 first-run 检测与 `--config` 早退分支的位置 |
| [sandbox.md](./sandbox.md) | `.atom/installed` 标记文件和沙箱目录结构 |
| [configuration.md](./configuration.md) | 向导输出的 config.json 结构与双层配置 |
