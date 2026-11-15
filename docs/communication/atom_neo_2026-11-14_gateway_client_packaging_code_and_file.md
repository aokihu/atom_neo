# Atom Neo — Gateway Client 打包接入：文件与代码

> 项目：`atom_neo`
> 日期：2026-11-14
> 开发目标：`gateway_client_packaging`
> 状态：**G0 已确认；M1（G1）、M2（G2）、M2.1、M3a（G3）、M3b（G4）、M4/G5 已实施；G6 待实施**
> 2026-11-15 修订：启动方式不再兼容旧 `binary`，实例只接受 `package` / `directory` 两种来源。M1 实际改动与偏差见 §13，M2 见 §14，M2.1 见 §15，M3a 见 §16，M3b 见 §17，G5 见 §18。
>
> 本文列出计划**修改**与**创建**的文件、职责、示例代码和测试。
> 计划见 [plan](./atom_neo_2026-11-14_gateway_client_packaging_plan.md)，关系图见 [graph](./atom_neo_2026-11-14_gateway_client_packaging_graph.md)。
> 示例代码用于确认职责与接口，不等于最终实现；G0 决策变化时同步更新。

---

## 1. 改动总览

### 1.1 新增文件

| 阶段 | 文件 | 职责 |
|---|---|---|
| G1 | <code>src/packages/shared/src/config/client-instance.ts</code> | 实例配置读写、凭据引用、并发保护 |
| G1 | <code>src/packages/gateway/src/client-package/manifest.ts</code> | manifest v1 解析、校验、入口选择 |
| G1 | <code>src/packages/gateway/src/client-package/resolver.ts</code> | 用户 Client 配置 → 可启动描述 |
| G1 | <code>src/packages/gateway/src/client-package/README.md</code> | 目录摘要与边界 |
| G2 | <code>src/packages/gateway/src/client-package/registry.ts</code> | `packages.json` 安装记录、内容 hash、引用检查 |
| G2 | <code>src/packages/gateway/src/client-package/archive.ts</code> | tar.gz pack / install、路径与链接安全 |
| G2 | <code>src/packages/gateway/src/client-package/instance-config.ts</code> | 离线实例配置库级 API（复用 client-instance） |
| G2 | `clients/telegram-bot/manifest.json` | 首个标准包与开发目录样例 |
| G3 | <code>src/packages/gateway/src/client-manager/diagnostics.ts</code> | 有界诊断事件 + 可选 Client `/diagnostics` 读取 |
| G3 | <code>src/bootstrap/gateway-command.ts</code> | `atom gateway ...` 离线/在线处理器 |
| G3 | <code>clients/telegram-bot/src/gateway-client.ts</code> | 入站提交、503/429 分类 |
| G3 | <code>clients/telegram-bot/src/update-loop.ts</code> | update offset / retry 纯逻辑 |
| G3 | <code>clients/telegram-bot/src/diagnostics.ts</code> | Telegram `getMe` 诊断（脱敏） |
| G2 | <code>src/packages/config-tui/src/components/GatewayInstanceForm.tsx</code> | manifest.config 驱动的首次实例表单 |
| G2 | <code>src/packages/config-tui/src/gateway-instance-form.ts</code> | 表单字段状态、enum/default/secret 纯逻辑 |
| G2 | <code>src/bootstrap/fixtures/gateway-client-e2e.ts</code> | 本地闭环 fake Client：发送 inbound、记录 task-result |
| G2 | <code>src/bootstrap/gateway-package.e2e.test.ts</code> | build → pack → install → configure → start → fake 往返 |
| G4 | <code>src/packages/config-tui/src/gateway-status.ts</code> | 读取 Gateway 运行状态、诊断并保存实例编辑 |
| G4 | <code>src/packages/config-tui/src/components/SecretFieldInput.tsx</code> | 真正遮罩的单行 secret 输入 |
| G4 | <code>src/packages/config-tui/src/components/GatewayModal.test.tsx</code> | 离线/列表/操作/reload 错误/编辑保存 UI 测试 |
| G4 | <code>src/packages/config-tui/src/gateway-status.test.ts</code> | 管理请求、诊断、持久化测试 |
| G4 | <code>src/bootstrap/gateway-actions.ts</code> | 配置 UI 到 CLI handler 的安装/加载/打包注入 |
| G4 | <code>src/packages/shared/src/runtime-file.ts</code> | 运行描述文件路径与读取的共享实现 |
| G4 | <code>src/packages/shared/src/runtime-file.test.ts</code> | 路径、解析、localUrl 测试 |
| G3 | `clients/telegram-bot/src/gateway-client.ts` | 入站提交与响应校验（可测试） |

### 1.2 修改文件

| 阶段 | 文件 | 改动 |
|---|---|---|
| G1 | `src/packages/shared/src/config/client.ts` | 增加 `package` / `directory` / `credentials`，二来源互斥，移除 `binary` / `platform` |
| G1 | `src/packages/shared/src/config/index.ts` | 导出实例配置模块与新类型 |
| G1 | `src/packages/shared/src/utils/child-process-env.ts` | 过滤实例凭据与管理 Token |
| G1 | `src/packages/gateway/src/client-manager/client-command.ts` | 从解析后的 command/cwd/env 启动 |
| G1 | `src/packages/gateway/src/client-manager/process-supervisor.ts` | 接收 `ResolvedClientConfig` |
| G1 | `src/packages/gateway/src/config.ts` | 解析前保持用户配置；启动时解析 |
| G2 | `clients/telegram-bot/package.json` | 构建输出 `bin/telegram-bot` |
| G2 | `src/packages/gateway/package.json` | 新增 `tar` 依赖（D8） |
| G2 | `src/packages/gateway/src/index.ts` | 导出 archive/registry/instance-config 供离线配置使用 |
| G2 | `src/packages/config-tui/src/index.ts` | 导出 `GatewayInstanceForm` 与表单逻辑 |
| G3 | `src/packages/gateway/src/client-manager/index.ts` | 动态登记、替换、移除、端口分配 |
| G3 | `src/packages/gateway/src/server.ts` | 管理接口、drain、诊断、状态 |
| G3 | `src/bootstrap/cli.ts` | 解析 `atom gateway ...` |
| G3 | `src/main.ts` | 新命令提前分流，不初始化 Core |
| G4 | `src/packages/config-tui/src/components/GatewayModal.tsx` | 实例列表、状态、诊断、操作入口、编辑/安装/加载/打包 |
| G4 | `src/packages/config-tui/src/components/GatewayInstanceForm.tsx` | 编辑模式、configured secret、外部持久化错误 |
| G4 | `src/packages/config-tui/src/app.tsx` / `components/WizardApp.tsx` / `wizard/WizardViews.tsx` | 注入 `GatewayInstanceActions` 与 sandbox |
| G4 | `src/bootstrap/runtime-file.ts` | 复用 shared 的运行描述读取，保留发布/清理 |
| G4 | `src/bootstrap/menu-flow.ts` / `menu-history.ts` | 菜单入口与参数记忆 |
| G4 | `src/bootstrap/cli.ts` / `gateway-command.ts` / `main.ts` | `load --id`、UI actions 注入、命令分流 |
| G4 | `src/packages/gateway/src/client-package/resolver.ts` | enum 校验、可选 default、secret 禁止进入 clientArgs |
| G4 | `src/packages/gateway/src/client-manager/index.ts` | 状态增加 config/clientArgs/secretFields/stdio（不含值） |
| G4 | `src/bootstrap/fixtures/menu-terminal.py` | PTY 尺寸可配置（窄窗口验收） |
| G3、G4 | `clients/telegram-bot/src/main.ts` | 非 2xx 处理（G3）、可选诊断端点（G4） |
| G6 | `docs/communication/gateway.md` 等 | 将验收通过能力迁入当前说明 |

> 现有 `src/packages/gateway/src/client-manager/README.md`、`src/bootstrap/README.md` 需同步更新职责表。

---

## 2. Shared：配置与凭据

### 2.1 `src/packages/shared/src/config/client.ts`（修改）

当前 schema 只接受 `binary`。新方案改为 `package` / `directory` 二选一，**不再接受 `binary`**，`platform` 由 manifest 解析。

```ts
import { z } from "zod";

const PackageRefSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
});

export const ClientConfigSchema = z.object({
  id: z.string().min(1),
  package: PackageRefSchema.optional(),
  directory: z.string().min(1).optional(),
  clientArgs: z.record(z.string(), z.string()).optional(),
  /** field -> sandbox .env 变量名，例如 bot-token -> ATOM_CLIENT_TELEGRAM_MAIN_BOT_TOKEN */
  credentials: z.record(z.string(), z.string()).optional(),
  stdio: z.enum(["inherit", "ignore"]).default("inherit"),
}).strict().superRefine((value, ctx) => {
  if ((value.package === undefined) === (value.directory === undefined)) {
    ctx.addIssue({
      code: "custom",
      message: "gateway.clients[] must define exactly one of package or directory; binary is not supported",
    });
  }
});

export type ClientConfig = z.infer<typeof ClientConfigSchema>;

export type ClientSource =
  | { type: "package"; id: string; version: string }
  | { type: "directory"; directory: string };

export function clientSource(config: ClientConfig): ClientSource {
  if (config.package) return { type: "package", ...config.package };
  if (config.directory) return { type: "directory", directory: config.directory };
  throw new Error(`Client ${config.id} has no launch source`);
}
```

**迁移要求**

- `binary` / `platform` 不再属于实例配置；`.strict()` 会拒绝未知字段。
- 配置加载器捕获 `binary` 的未知字段错误时，返回明确迁移提示：改用 `package` 或 `directory`。
- 不自动迁移旧配置；升级后必须重新登记实例。
- 包/目录的平台由 manifest 提供，实例配置不再重复声明。
- 不在 shared 中解析 manifest 或读取包目录。

### 2.2 <code>src/packages/shared/src/config/client-instance.ts</code>（新增）

职责：本机 CLI / 配置向导的**唯一写入入口**；Gateway 只读。

```ts
import type { ClientConfig } from "./client";

export type InstanceWriteResult = {
  saved: true;
  applied: false;
  configPath: string;
  envPath?: string;
};

export function listInstances(sandbox: string): ClientConfig[];

export function upsertInstance(
  sandbox: string,
  instance: ClientConfig,
  secrets: Record<string, string>,
): InstanceWriteResult;

export function removeInstance(sandbox: string, id: string): void;
```

实现要求：

- 使用现有 `writeFileAtomic` 与 `upsertEnv`，不新建写盘工具。
- `config.json` 保留未知字段；只替换目标 `gateway.clients[]` 条目。
- 凭据只写 `.env`，键名使用 `ATOM_CLIENT_<ID>_<FIELD>` 规范化形式。
- 写入前获取 sandbox 级 lockfile；写入前后比对并递增 `.atom/gateway/state.json` 的 `configRevision`（G0 D4）。锁为 fail-fast；崩溃遗留锁需人工清理。
- 规范化后相同的凭据引用必须拒绝（例如实例 `a-b` 与 `a_b`），避免不同实例共享同一个 `.env` 变量。
- 写入失败按 `.env` → `config.json` → `state.json` 顺序回滚；取消或失败不留下半成品实例。
- G2 CLI/向导应把 `directory` 规范化为绝对路径再写入；resolver 仍支持相对路径，但以 sandbox 根目录为基准。
- 返回 `saved/applied` 分离状态；Gateway 离线时 `applied=false`。

### 2.3 `src/packages/shared/src/config/index.ts`（修改）

```ts
export * from "./client";
export * from "./client-instance";
```

### 2.4 `src/packages/shared/src/utils/child-process-env.ts`（修改）

```ts
const INSTANCE_CREDENTIAL_PREFIX = "ATOM_CLIENT_";

export function createChildProcessEnv(
  source: NodeJS.ProcessEnv = process.env,
  injected: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const env = { ...source };
  delete env.ATOM_ADMIN_TOKEN;
  for (const key of Object.keys(env)) {
    if (key.startsWith(INSTANCE_CREDENTIAL_PREFIX)) delete env[key];
  }
  return { ...env, ...injected };
}
```

> 只注入目标实例解析出的变量；`.env` 中其他实例的 `ATOM_CLIENT_*` 不得进入子进程。

### 2.5 <code>src/packages/shared/src/runtime-file.ts</code>（新增）

为 CLI、config-tui 和 bootstrap 提供同一份运行描述读取，避免重复路径与 JSON 解析：

```ts
export type RuntimeFile = {
  url: string;
  token: string;
  instanceId: string;
};

export function runtimeFilePath(sandbox: string, kind: "core" | "gateway"): string;

export function readRuntimeFile(sandbox: string, kind: "core" | "gateway"): RuntimeFile;
```

- `src/bootstrap/runtime-file.ts` 改为复用该模块，只保留发布、实例校验与清理。
- `config-tui/src/gateway-status.ts` 使用同一读取函数。
- 读取失败/文件不存在返回明确错误，不猜测地址。

---

## 3. Gateway：manifest、包与解析

### 3.1 新增目录 <code>src/packages/gateway/src/client-package/</code>

需要 `README.md`，说明：

| 文件 | 职责 |
|---|---|
| `manifest.ts` | manifest v1 schema、解析、入口选择 |
| `resolver.ts` | 用户配置 → 可启动描述、凭据注入 |
| `registry.ts` | `packages.json` 读写与版本登记 |
| `archive.ts` | tar.gz 打包、安装、路径边界校验 |

### 3.2 `manifest.ts`（新增）

```ts
import { z } from "zod";

const EntrySchema = z.object({
  production: z.array(z.string().min(1)).min(1).optional(),
  development: z.array(z.string().min(1)).min(1).optional(),
}).refine((value) => value.production || value.development, {
  message: "manifest.entry requires production or development",
});

const ConfigFieldSchema = z.object({
  label: z.string().min(1),
  type: z.literal("string"),
  required: z.boolean().default(false),
  secret: z.boolean().default(false),
  enum: z.array(z.string()).min(1).optional(),
  default: z.string().optional(),
  env: z.string().min(1).optional(),
});

export const ManifestSchema = z.object({
  manifest_version: z.literal(1),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  platform: z.string().min(1),
  entry: EntrySchema,
  config: z.record(z.string(), ConfigFieldSchema).optional(),
  target: z.string().min(1).optional(),
  description: z.string().optional(),
  author: z.string().optional(),
  homepage_url: z.string().url().optional(),
  icons: z.array(z.string()).optional(),
}).strict();

export type Manifest = z.infer<typeof ManifestSchema>;

export function parseManifest(text: string): Manifest {
  return ManifestSchema.parse(JSON.parse(text));
}

export function resolveEntry(manifest: Manifest, mode: "package" | "directory"): readonly string[] {
  const entry = mode === "package" ? manifest.entry.production : manifest.entry.development;
  if (!entry) {
    throw new Error(`manifest.entry.${mode === "package" ? "production" : "development"} is required`);
  }
  return entry;
}
```

### 3.3 `resolver.ts`（新增）

```ts
import { createChildProcessEnv } from "@atom-neo/shared";
import type { ClientConfig, ClientSource } from "@atom-neo/shared";
import { parseManifest } from "./manifest";
import type { Manifest } from "./manifest";

export type ResolvedClientConfig = {
  id: string;
  platform: string;
  command: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  clientArgs?: Record<string, string>;
  stdio: "inherit" | "ignore";
  source: ClientSource;
};

export type ResolveOptions = {
  packageRoot: (id: string, version: string) => string;
  baseDir?: string;
  readEnv?: (key: string) => string | undefined;
  baseEnv?: NodeJS.ProcessEnv;
};

export function resolveClient(config: ClientConfig, options: ResolveOptions): ResolvedClientConfig {
  const root = config.directory
    ? resolve(options.baseDir ?? process.cwd(), config.directory)
    : options.packageRoot(config.package!.id, config.package!.version);
  const manifest = parseManifest(readFileSync(join(root, "manifest.json"), "utf-8"));
  const entry = resolveEntry(manifest, config.directory ? "directory" : "package");

  return {
    id: config.id,
    platform: manifest.platform,
    command: entry,
    cwd: root,
    env: buildClientEnv(config, manifest, options.readEnv),
    clientArgs: config.clientArgs,
    stdio: config.stdio,
    source: config.directory
      ? { type: "directory", directory: config.directory }
      : { type: "package", ...config.package! },
  };
}
```

路径契约：`directory` 可为绝对路径；相对路径相对 `baseDir` 解析。`src/main.ts` 启动 Gateway 时传入 `baseDir: args.sandbox`，因此用户配置中的相对目录以 sandbox 根目录为基准。G2 的 CLI/向导应优先写入绝对路径。

包路径：`sandboxPackageRoot(sandbox)` 只读取 registry 登记记录，不提供手工目录 fallback；命中记录时要求 `record.target === ${process.platform}-${process.arch}`，否则明确报错。

`manifest.config.required` 在启动前校验：secret 字段必须在 `credentials` 中有引用；非 secret 字段必须在 `clientArgs` 中有同名参数。可选非 secret 字段缺失时 resolver 应用 manifest `default`；`clientArgs` 必须满足 manifest `enum`，secret 字段不得进入 `clientArgs`。G2 配置表单仍负责预填/选择。

凭据映射：

```ts
function buildClientEnv(
  instance: ClientConfig,
  manifest: Manifest,
  readEnv: (key: string) => string | undefined,
): NodeJS.ProcessEnv {
  const injected: NodeJS.ProcessEnv = {};
  for (const [field, declared] of Object.entries(manifest.config ?? {})) {
    if (!declared.required) continue;
    if (declared.secret && instance.credentials?.[field] === undefined) {
      throw new Error(`Client ${instance.id} is missing required credential ${field}`);
    }
    if (!declared.secret && instance.clientArgs?.[field] === undefined) {
      throw new Error(`Client ${instance.id} is missing required argument --${field}`);
    }
  }
  for (const [field, ref] of Object.entries(instance.credentials ?? {})) {
    if (!ref.startsWith("ATOM_CLIENT_")) {
      throw new Error(`Client ${instance.id} credential ${field} must use ATOM_CLIENT_ prefix`);
    }
    const declared = manifest.config?.[field];
    if (!declared || !declared.secret || !declared.env) {
      throw new Error(`Client ${instance.id} field ${field} is not a secret env field`);
    }
    const value = readEnv(ref);
    if (!value) throw new Error(`Client ${instance.id} missing credential ${ref}`);
    injected[declared.env] = value;
  }
  return createChildProcessEnv(process.env, injected);
}
```

### 3.4 `registry.ts`（新增）

`$SANDBOX/.atom/gateway/packages.json`：

```jsonc
{
  "version": 1,
  "packages": {
    "telegram-bot": {
      "0.1.0": {
        "target": "darwin-arm64",
        "path": ".atom/gateway/packages/telegram-bot/0.1.0/darwin-arm64",
        "source": "local:./telegram-bot-0.1.0-darwin-arm64.tar.gz",
        "installedAt": "2026-11-14T00:00:00.000Z",
        "sha256": "content-hash-of-manifest-and-bin-payload"
      }
    }
  }
}
```

接口：

```ts
export type PackageRecord = {
  target: string;
  path: string; // relative to sandbox
  source: string;
  installedAt: string;
  sha256: string; // deterministic hash of manifest.json + bin payload
};

export function readRegistry(sandbox: string): PackageRegistry;
export function findPackage(sandbox: string, id: string, version: string): PackageRecord | undefined;
export function registerPackage(sandbox: string, registration: PackageRegistration): PackageRecord;
export function removePackage(sandbox: string, id: string, version: string): void;
export function listPackages(sandbox: string): { id: string; version: string; record: PackageRecord }[];
```

要求：

- 写入使用临时文件 + rename。
- 同 id/version 但 `sha256`/target/path 不同拒绝覆盖；完全相同幂等并保留 `installedAt`。
- `sha256` 为 `manifest.json` + `bin/**` 的确定性内容哈希，不使用 gzip 字节（tar mtime 不影响幂等）。
- 删除前检查 `gateway.clients[].package` 引用；`removePackage` 只删登记，不删包目录。

### 3.5 `archive.ts`（新增）

```ts
export type PackOptions = {
  out?: string;
  target?: string;
};

export async function packClient(root: string, options?: PackOptions): Promise<string>;
export async function installClient(sandbox: string, archive: string): Promise<PackageRecord>;
```

要求：

- `pack` 读取并校验 manifest，要求 `entry.production` 存在；生产入口必须位于 `bin/` 且为真实文件。
- 只收集 `manifest.json` 与 `bin/**`；排除 `.env`、`node_modules`、`src/`、日志和运行数据；归档 manifest 写入本次 target。
- 默认输出 `<root>/dist/<id>-<version>-<target>.tar.gz`。
- `install` 解包到 `${sandbox}/.atom/gateway/tmp`，校验绝对路径、`..`、符号链接/硬链接、target 与 production 入口，再原子提交到 `packages/<id>/<version>/<target>`。
- target 必须与当前 `${process.platform}-${process.arch}` 一致；不支持时明确报错。
- 失败清理临时目录，不覆盖已有版本；registry 写入失败时删除已提交目录。
- 归档实现使用新增 `tar` 依赖，不拼 shell 命令（G0 D8）。

### 3.6 `src/packages/gateway/src/config.ts`（修改）

- `GatewayConfig.clients` 继续使用扩展后的 `ClientConfig[]`。
- 启动时由 `resolveClients()` 解析为 `ResolvedClientConfig[]`，再交给 `ClientManager`。
- 包/目录解析失败必须指出实例 ID、来源和缺失项。

---

## 4. Gateway：ClientManager 与启动

### 4.1 `client-command.ts`（修改）

```ts
export function buildClientCommand(
  client: ResolvedClientConfig,
  active: ActiveClient,
  gatewayPort: number,
): string[] {
  return [
    ...client.command,
    "--secret", active.secret,
    "--port", String(active.port),
    "--gateway-url", `http://127.0.0.1:${gatewayPort}`,
    ...buildClientArgs(client.clientArgs),
  ];
}

export function buildSpawnOptions(
  stdio: "inherit" | "ignore",
  env: NodeJS.ProcessEnv,
  cwd: string,
  onExit: NonNullable<SpawnProcessOptions["onExit"]>,
): SpawnProcessOptions {
  return { env, cwd, stdin: "ignore", stdout: stdio, stderr: stdio, onExit };
}
```

> `cwd` 由 `ResolvedClientConfig` 提供，调用 `buildSpawnOptions` 时直接传入。

### 4.2 `process-supervisor.ts`（修改）

- `ProcessSupervisorDeps.config` 从 `ClientConfig` 改为 `ResolvedClientConfig`。
- spawn 时使用 `config.command`、`config.cwd`、`config.env`。
- 状态机、队列、重启策略、Secret 生命周期不变。

### 4.3 `client-manager/index.ts`（修改）

当前构造时按数组索引分配端口，`stopAll` 遍历 `config.clients`。动态实例需要改为遍历实际 supervisor。

```ts
export class ClientManager {
  #configs = new Map<string, ResolvedClientConfig>();
  #supervisors = new Map<string, ProcessSupervisor>();
  #ports = new Set<number>();
  #portStart: number;

  register(config: ResolvedClientConfig): void {
    if (this.#supervisors.has(config.id)) throw new Error(`Client already registered: ${config.id}`);
    const port = this.#allocatePort();
    this.#configs.set(config.id, config);
    this.#supervisors.set(config.id, this.#createSupervisor(config, port));
  }

  async remove(id: string): Promise<void> {
    const supervisor = this.#supervisors.get(id);
    if (!supervisor) throw new Error(`Unknown client: ${id}`);
    await supervisor.stop();
    this.#supervisors.delete(id);
    this.#configs.delete(id);
    this.#ports.delete(supervisor.port);
  }

  async reload(id: string, config: ResolvedClientConfig): Promise<void> {
    const previous = this.#supervisors.get(id);
    if (!previous) throw new Error(`Unknown client: ${id}`);
    const port = previous.port;
    const wasDesired = previous.desired;
    await previous.stop();
    this.#configs.set(id, config);
    const next = this.#createSupervisor(config, port);
    this.#supervisors.set(id, next);
    if (wasDesired) await next.start();
  }

  async stopAll(): Promise<void> {
    const results = await Promise.allSettled(
      [...this.#supervisors.values()].map((supervisor) => supervisor.stop()),
    );
    // AggregateError 逻辑不变
  }

  #allocatePort(): number {
    for (let port = this.#portStart; port < this.#portStart + 10_000; port++) {
      if (!this.#ports.has(port)) {
        this.#ports.add(port);
        return port;
      }
    }
    throw new Error("No free client port");
  }
}
```

要求：

- 端口按活动实例集合分配，不再按数组索引。
- `getBySecret`、`getById`、`list` 遍历 supervisor。
- 重载期间旧 supervisor 的 exit 回调、restart timer 不得影响新 supervisor。
- `stopAll` 后无残留 timer；测试使用 `FakeClock.pendingTimers` 断言。

---

## 5. Gateway：管理接口与诊断

### 5.1 `server.ts`（修改）

新增：

| 路由 | 方法 | 作用 |
|---|---|---|
| `/admin/clients` | GET | 实例列表、状态、诊断摘要 |
| `/admin/clients` | POST | `start` / `stop` / `reload` |
| `/admin/clients/:id/diagnostics` | GET | 指定实例诊断事件 |

保留：

- `/gateway/inbound`
- `/gateway/event`
- `/admin/clients` 现有 start/stop 语义与逐项结果

drain：

```ts
const inFlight = new Map<string, number>();
const draining = new Set<string>();

function beginInbound(id: string): boolean {
  if (draining.has(id)) return false;
  inFlight.set(id, (inFlight.get(id) ?? 0) + 1);
  return true;
}

function endInbound(id: string): void {
  const count = (inFlight.get(id) ?? 1) - 1;
  if (count <= 0) inFlight.delete(id);
  else inFlight.set(id, count);
}

async function waitDrained(id: string, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while ((inFlight.get(id) ?? 0) > 0) {
    if (Date.now() >= deadline) return false;
    await sleep(50);
  }
  return true;
}
```

reload 流程：

```ts
async function reloadClient(id: string): Promise<Response> {
  if (!resolveClient) return Response.json({ error: "Reload unsupported" }, { status: 501 });
  draining.add(id);
  try {
    const drained = await waitDrained(id);
    if (!drained) return Response.json({ error: "Client busy" }, { status: 409 });
    const config = await resolveClient(id);
    await cm.reload(id, config);
    diagnostics.record(id, { stage: "process", level: "info", message: "reloaded" });
    return Response.json({ ok: true, clients: cm.list() });
  } finally {
    draining.delete(id);
  }
}
```

`startGateway` 增加可选 `resolveClient`：

```ts
export type GatewayOverrides = Partial<GatewayConfig> & {
  adminToken?: string;
  logger?: Logger;
  httpServer?: HttpServer;
  resolveClient?: (id: string) => Promise<ResolvedClientConfig>;
};
```

> 由 `src/main.ts` 提供回调，Gateway 包不直接读取 sandbox 配置；这样保持包边界。

### 5.2 `diagnostics.ts`（新增）

```ts
export type DiagnosticStage = "install" | "config" | "process" | "platform" | "delivery";
export type DiagnosticEvent = {
  at: string;
  stage: DiagnosticStage;
  level: "info" | "warn" | "error";
  message: string;
};

export class DiagnosticsStore {
  #events = new Map<string, DiagnosticEvent[]>();

  record(id: string, event: DiagnosticEvent): void {
    const list = this.#events.get(id) ?? [];
    list.push(event);
    if (list.length > 50) list.shift();
    this.#events.set(id, list);
  }

  list(id: string): DiagnosticEvent[] {
    return [...(this.#events.get(id) ?? [])];
  }
}
```

### 5.3 Client 可选诊断协议

`GET /diagnostics`：

```jsonc
{
  "ok": true,
  "checks": [
    { "name": "telegram.getMe", "ok": true, "at": "2026-11-14T00:00:00.000Z" }
  ]
}
```

- 未实现 `/diagnostics` 的 Client 返回 404 → Gateway 显示 `unsupported`。
- `/health` 只证明本机 HTTP 就绪，不等于平台凭据有效。
- 诊断结果有界，不包含 Token/Secret。

---

## 6. Bootstrap：CLI 与菜单

### 6.1 `src/bootstrap/cli.ts`（修改）

新增顶层命令：

```text
atom gateway <install|load|reload|list|start|stop|check|logs|pack|uninstall> [target]
```

示例：

```bash
atom gateway install ./telegram-bot-0.1.0-darwin-arm64.tar.gz --sandbox ./sandbox
atom gateway install telegram --sandbox ./sandbox
atom gateway load ./clients/telegram-bot --sandbox ./sandbox
atom gateway reload telegram-dev --sandbox ./sandbox
atom gateway list --sandbox ./sandbox
atom gateway start telegram-main --sandbox ./sandbox
atom gateway check telegram-main --sandbox ./sandbox
atom gateway logs telegram-dev --sandbox ./sandbox
atom gateway pack ./clients/telegram-bot
atom gateway uninstall telegram-main --sandbox ./sandbox
```

解析要点：

- `gateway` 作为第一个 positional 时进入子命令解析。
- `--sandbox` 必填或缺省复用现有规则。
- `--out`、`--target`、`--force`、`--json` 按子命令允许。
- 与 `--mode gateway` 的 `--action` 不混用。
- 非交互缺必填参数直接报错，不挂起等待输入。
- 部分失败退出码 1，并输出逐项结果。

返回类型：

```ts
export type GatewayCommand = {
  action: "install" | "load" | "reload" | "list" | "start" | "stop" | "check" | "logs" | "pack" | "uninstall";
  target?: string;
  out?: string;
  targetPlatform?: string;
  force: boolean;
  json: boolean;
};
```

### 6.2 <code>src/bootstrap/gateway-command.ts</code>（新增）

```ts
export async function runGatewayCommand(command: GatewayCommand, args: BootArguments): Promise<void> {
  switch (command.action) {
    case "install": {
      const record = await installClient(args.sandbox, command.target!);
      console.log(`Installed ${record.source} (${record.target})`);
      return;
    }
    case "load": {
      const instance = await registerDevelopmentDirectory(args.sandbox, command.target!);
      console.log(`Loaded ${instance.id}; saved, not started`);
      return;
    }
    case "reload":
      return callAdmin(args.sandbox, { action: "reload", clientId: command.target });
    case "list":
      return callAdmin(args.sandbox, undefined, "GET");
    case "start":
    case "stop":
      return callAdmin(args.sandbox, { action: command.action, clientId: command.target });
    case "check":
      return callAdmin(args.sandbox, { action: "check", clientId: command.target });
    case "logs":
      return readInstanceLogs(args.sandbox, command.target!);
    case "pack":
      return packClient(command.target!, { out: command.out, target: command.targetPlatform });
    case "uninstall":
      return uninstallPackage(args.sandbox, command.target!);
  }
}
```

要求：

- `install` / `load` / `pack` / `uninstall` 可离线执行。
- `start` / `stop` / `reload` / `check` / `logs` 通过 `readRuntimeFile(sandbox, "gateway")` 发现服务；服务离线时明确报错，不自动启动。
- 不初始化 Core 数据库、Provider、TUI。

### 6.3 `src/main.ts`（修改）

在 Core 初始化前分流：

```ts
if (args.gatewayCommand) {
  const { runGatewayCommand } = await import("./bootstrap/gateway-command");
  await runGatewayCommand(args.gatewayCommand, args);
  return;
}
```

### 6.4 `menu-flow.ts` / `menu-history.ts`（修改）

在 `gateway` 菜单下增量增加：

```text
gateway >
  run >
  start clients >
  stop clients >
  install >
  load directory >
  manage instances >   # list/check/reload/logs
  pack >
```

- 保持单列层级与执行交接。
- 不记录 Token/Secret。
- 新命令参数记忆仅保存 sandbox、实例 ID、目录等非敏感值。
- 非交互失败返回明确错误。

---

## 7. Config TUI：实例管理

### 7.1 `GatewayModal.tsx`（修改）

从“仅端口”升级为：

- 实例列表：ID、来源（包/目录）、版本或目录、supervisor 进程状态、端口、平台、最近 warn/error。
- 操作面板：start/stop/reload、check（Client `/diagnostics`）、diagnostics/logs、编辑配置。
- 离线入口：install、load（可选实例 ID）、pack（开发者）、Gateway 端口。
- reload 失败直接显示服务端返回的 `results[].error`，不是裸 400；成功显示通知。
- 不做第二套状态源：列表来自 `GET /admin/clients`；平台检查只在 check 视图中读取 Client 诊断。

### 7.2 `GatewayInstanceForm.tsx` / `SecretFieldInput.tsx`

- 由 `manifest.config` 驱动字段。
- 复用 `FieldInput`、`Modal`、`SelectableRow`。
- `secret` 字段只写 `.env`；编辑态空白表示保持已配置值。
- `SecretFieldInput` 使用 `useKeyboard`/`usePaste`，固定宽度 `••••••`，原始输入只存在组件状态，不渲染、不记录。
- `enum` 使用选择行；可选非 secret 字段应用 manifest `default`。
- 取消不提交；持久化失败在表单内显示。

### 7.3 `gateway-status.ts`（新增）

```ts
export type GatewayInstanceStatus = {
  id: string;
  platform: string;
  source: { type: "package"; id: string; version: string } | { type: "directory"; directory: string };
  running: boolean;
  desired: boolean;
  state: string;
  port: number;
  diagnostics: DiagnosticEvent[];
  config: GatewayInstanceFields;
  clientArgs: Record<string, string>;
  secretFields: string[];
  stdio: "inherit" | "ignore";
};

export async function fetchGatewayStatus(sandbox: string): Promise<GatewayInstanceStatus[] | null>;
export async function fetchGatewayDiagnostics(sandbox: string, id: string): Promise<GatewayDiagnostics>;
export async function gatewayAction(sandbox: string, action: "start" | "stop" | "reload", id?: string): Promise<unknown>;
export function saveGatewayInstance(sandbox: string, status: GatewayInstanceStatus, values: Record<string, string>, secrets?: Record<string, string>): InstanceWriteResult;
```

- 通过 shared `runtime-file.ts` 读取 `.atom/gateway-runtime.json`，不复制路径解析逻辑。
- 离线返回 `null`，UI 显示 `OFFLINE`。
- 使用本机管理 Token；不把 Token 写入日志或历史。
- 保存复用 `upsertInstance` 单写入口；保留 source/credentials，只更新声明的非 secret args 与显式新 secret。

### 7.4 `gateway-actions.ts`（新增）

`createGatewayActions(sandbox)` 把 UI 的 install/load/pack 请求转成 `GatewayCommand`，复用 `runGatewayCommand` 并捕获 stdout 供 Modal 显示；secret 不经过该层。

---

## 8. Telegram Client

### 8.1 `clients/telegram-bot/manifest.json`（新增）

```json
{
  "manifest_version": 1,
  "id": "telegram-bot",
  "name": "Telegram Bot",
  "version": "0.1.0",
  "platform": "telegram",
  "entry": {
    "production": ["./bin/telegram-bot"],
    "development": ["bun", "run", "src/main.ts"]
  },
  "config": {
    "bot-token": {
      "label": "Bot Token",
      "type": "string",
      "required": true,
      "secret": true,
      "env": "TELEGRAM_BOT_TOKEN"
    },
    "mode": {
      "label": "连接方式",
      "type": "string",
      "enum": ["longpoll", "webhook"],
      "default": "longpoll"
    },
    "webhook-url": {
      "label": "Webhook URL",
      "type": "string"
    },
    "webhook-secret": {
      "label": "Webhook Secret",
      "type": "string",
      "secret": true,
      "env": "TELEGRAM_WEBHOOK_SECRET"
    }
  }
}
```

> webhook 条件必填由 Telegram Client 校验；v1 不引入通用表达式语言。

### 8.2 `clients/telegram-bot/package.json`（修改）

```json
{
  "scripts": {
    "build": "bun build src/main.ts --compile --outfile bin/telegram-bot"
  }
}
```

- 构建产物路径与 manifest `entry.production` 一致。
- 不自动安装依赖或执行构建脚本。

### 8.3 `clients/telegram-bot/src/gateway-client.ts`（新增）

把入站提交抽成可测试函数：

```ts
export async function submitInbound(input: {
  gatewayUrl: string;
  secret: string;
  platformUserId: string;
  text: string;
  fetchImpl?: typeof fetch;
}): Promise<Response> {
  const res = await (input.fetchImpl ?? fetch)(`${input.gatewayUrl}/gateway/inbound`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Gateway-Secret": input.secret },
    body: JSON.stringify({
      type: "message",
      platform: "telegram",
      platformUserId: input.platformUserId,
      data: { text: input.text },
    }),
  });
  if (res.status === 503 || res.status === 429) {
    throw new Error(`gateway busy or rate limited (${res.status})`);
  }
  if (!res.ok) throw new Error(`gateway rejected message (${res.status})`);
  return res;
}
```

### 8.4 `clients/telegram-bot/src/main.ts`（修改）

- `handleUpdate` 使用 `submitInbound`。
- 503/429 抛错，交由 `pollOnce` 现有重试与 `updateOffset` 逻辑处理，不推进 offset。
- 可选 `GET /diagnostics` 调用 `getMe` 并返回有界结果。
- 不把 Bot Token 写入日志、诊断或打包内容。

---

## 9. 测试文件

| 测试 | 覆盖 |
|---|---|
| `src/packages/shared/src/config/config.test.ts`（扩展） | `binary` 拒绝、包/目录二来源互斥、凭据字段、迁移提示 |
| <code>src/packages/gateway/src/client-package/manifest.test.ts</code> | 六字段、未知版本、entry、target、严格模式 |
| <code>src/packages/gateway/src/client-package/resolver.test.ts</code> | package/directory、cwd、env、platform 来源、保留参数 |
| <code>src/packages/gateway/src/client-package/registry.test.ts</code> | 登记、幂等、冲突、删除引用检查 |
| <code>src/packages/gateway/src/client-package/archive.test.ts</code> | pack 内容、路径逃逸、链接逃逸、失败清理 |
| `src/packages/gateway/src/client-manager/client-manager.test.ts`（扩展） | 动态登记、移除、重载、端口分配 |
| `src/packages/gateway/src/client-manager/process-supervisor.test.ts`（扩展） | 旧回调/timer 隔离、Secret 撤销 |
| `src/packages/gateway/src/server.test.ts`（扩展） | GET 列表、reload、drain、503、诊断 |
| `src/bootstrap/cli.test.ts`（扩展） | 新子命令、非法参数、退出码 |
| <code>src/bootstrap/gateway-command.test.ts</code> | 离线 install/load、在线 start/stop/reload、服务离线 |
| `clients/telegram-bot/src/gateway-client.test.ts` | 2xx、400、429、503、网络错误 |
| `src/packages/config-tui` 对应测试 | 实例列表、表单、取消、离线状态 |

测试使用 fake spawn/fetch/clock 和临时 sandbox；不启动真实 Client 或使用真实平台凭据。

---

## 10. 文档更新

| 文档 | 更新 |
|---|---|
| `docs/communication/gateway.md` | manifest、包、实例、管理接口、诊断、重载 |
| `docs/communication/gateway-client-design.md` | 回写 G0 确认结果 |
| `docs/communication/gateway-development-plan.md` | 标记阶段进度与实现差异 |
| `docs/clients/telegram-bot.md` | manifest、构建产物、非 2xx、诊断 |
| `docs/subsystems/configuration.md` | 包/目录引用、凭据引用、写入所有权 |
| `docs/subsystems/startup-menu.md` | 新菜单入口 |
| `docs/subsystems/sandbox.md` | `.atom/gateway/` 目录结构 |
| `docs/overview/project-structure.md` | 新目录与文件 |
| `docs/index.md` | 三份文档与新入口 |
| <code>src/packages/gateway/src/client-package/README.md</code> | 新目录摘要 |
| `src/bootstrap/README.md` | 新命令与分流 |
| `src/packages/config-tui/src/wizard/README.md` | 新增组件 |

---

## 11. 实施顺序与依赖

```text
G0 契约确认
  → shared schema + client-instance
  → manifest + resolver
  → client-command/process-supervisor 接入 ResolvedClientConfig
  → registry + archive + Telegram manifest
  → ClientManager 动态 + server admin/drain
  → bootstrap CLI/main
  → config-tui / menu
  → 官方安装/升级/卸载
  → 文档与完整验收
```

每个阶段先写/更新对应文档与测试，再改实现；每阶段结束运行定向测试与 `bun run typecheck`。

---

## 12. 决策状态

- [x] D1–D9 已由用户确认，全部采用推荐方案；结论见 [plan §4.2](./atom_neo_2026-11-14_gateway_client_packaging_plan.md#42-g0契约收口)
- [x] 新增 `tar` 依赖（D8；G2 使用）
- [x] 接受 `shared/client-instance.ts` 作为唯一写盘入口（D4）
- [x] G4 首轮包含离线配置 + CLI 状态，在线状态 UI 依赖 G3
- [x] 多账号首版明确按现有 `platform:userId` 边界，不宣称完整多账号（D6）

## 13. M1 实施记录（2026-11-15）

本轮只实施 G0 + G1，不含 G2–G6。

| 子任务 | 实际产出 | 测试结果 |
|---|---|---|
| G1-1 | `shared/config/client.ts`：package/directory 二选一、credentials、旧 `binary`/`platform` 拒绝 | `bun test src/packages/shared/src/config/config.test.ts` → 21 pass |
| G1-2 | `shared/config/client-instance.ts`：实例读写、凭据引用、lockfile、`configRevision`、写入回滚 | `bun test src/packages/shared/src/config/client-instance.test.ts` → 18 pass |
| G1-3 | `gateway/client-package/manifest.ts`、`README.md`：manifest v1 严格校验与入口选择 | `bun test src/packages/gateway/src/client-package/manifest.test.ts` → 17 pass |
| G1-4 | `gateway/client-package/resolver.ts`：package/directory → command/cwd/platform/env；相对目录 baseDir；required 校验 | `bun test src/packages/gateway/src/client-package/resolver.test.ts` → 17 pass / 1 skip |
| G1-5 | `shared/utils/child-process-env.ts`：实例凭据隔离与管理 Token 过滤 | `bun test src/packages/shared/src/utils/child-process-env.test.ts` → 7 pass |
| G1-6 | `client-command.ts` / `process-supervisor.ts` / `client-manager/index.ts` / `server.ts` / `main.ts` 接入 `ResolvedClientConfig` | `bun test src/packages/gateway/src/client-manager src/packages/gateway/src/server.test.ts src/packages/gateway/src/config.test.ts` → 57 pass |
| G1-7 | fake runtime 集成测试：package、directory、旧 binary 拒绝、凭据隔离、保留参数 | `bun test src/packages/gateway/src/client-package/integration.test.ts` → 5 pass |

额外验证：`bun test src/packages/gateway/src src/packages/shared/src/config src/packages/shared/src/utils/child-process-env.test.ts src/bootstrap/config.test.ts` → 159 pass / 1 skip；`bun run typecheck`、`bun run typecheck:node`、`bun run docs:check`、`git diff --check` 通过。

> 注意：仓库中可能存在被忽略的 `src/packages/gateway/dist` 旧编译测试；直接运行 `bun test src/packages/gateway` 会把它们一起执行并因旧 `binary` fixture 失败。M1 验证使用 `src/packages/gateway/src` 路径。

实施偏差：

- M1 的 `ClientManager` 仍按启动时数组构造 supervisor；动态登记/重载/活动端口集合归 G3（计划 §4.3 的 G1-6 只要求统一启动描述）。
- `main.ts` 启动前解析实例；包安装目录通过 resolver 的 `packageRoot` 注入，`packages.json` 登记与安装归 G2。
- `directory` 相对路径以 sandbox 根目录为基准（`main.ts` 传 `baseDir`）；G2 CLI/向导应写入绝对路径。
- `manifest.config.required` 已在启动前校验（secret -> `credentials`，非 secret -> `clientArgs`）；可选非 secret 字段缺失时 resolver 应用 manifest `default`；`clientArgs` enum 在启动前校验，secret 字段不得进入 `clientArgs`。
- `client-instance.removeInstance` 不删除 `.env` 中的凭据值，只移除实例配置；显式凭据删除归 G5 卸载流程。
- 未实现新 CLI/TUI 入口、`registry.ts`、`archive.ts`、管理接口、drain、诊断协议与 Telegram 改动，均属于后续阶段。

## 14. M2 实施记录（2026-11-15）

本轮实施 G2-1..G2-8，不进入 G3/G4。

| 子任务 | 实际产出 | 测试结果 |
|---|---|---|
| G2-1 | `clients/telegram-bot/manifest.json`；构建输出 `bin/telegram-bot` | `bun run --cwd clients/telegram-bot build` + typecheck |
| G2-2 | `client-package/archive.ts` pack 白名单、target 注入、敏感文件排除 | `bun test src/packages/gateway/src/client-package/archive.test.ts` → 21 pass（含 install） |
| G2-3 | archive 路径/链接/类型/临时目录安全校验 | 同上 |
| G2-4 | `client-package/registry.ts` 原子读写、`sha256` 幂等/冲突、引用检查 | `bun test .../registry.test.ts` → 11 pass |
| G2-5 | `installClient` 解包、target/production 校验、提交/回滚 | `bun test .../archive.test.ts` → 7 install tests |
| G2-6 | `client-package/instance-config.ts` 离线配置 API | `bun test .../instance-config.test.ts` → 10 pass |
| G2-7 | `GatewayInstanceForm.tsx` + 纯逻辑 | `bun test src/packages/config-tui/src/gateway-instance-form.test.ts` → 15 pass |
| G2-8 | 临时 sandbox e2e | `bun test src/bootstrap/gateway-package.e2e.test.ts` → 1 pass |

额外验证：

- `bun test src/packages/gateway/src` → 139 pass / 1 skip
- `bun test src/packages/config-tui/src src/bootstrap/gateway-package.e2e.test.ts src/bootstrap/config.test.ts src/bootstrap/cli.test.ts` → 146 pass
- `bun run --cwd clients/telegram-bot typecheck`、`bun run --cwd clients/telegram-bot build` → 通过，`bin/telegram-bot` 存在
- `bun run typecheck`、`bun run typecheck:node`、`bun run docs:check`、`git diff --check` → 通过

> `dist/` 是忽略的构建产物，不作为测试来源；Gateway 验证固定使用 `src/packages/gateway/src`。

实施偏差：

- registry `PackageRecord` 增加 `sha256` 内容标识，以满足同版本冲突判定；D3 嵌套结构不变。
- pack 默认输出改为 Client 根目录下的 `dist/`，`out` 可覆盖；文档已同步。
- `installClient` 只接受当前主机 target；跨 target 安装归 G5。
- `sandboxPackageRoot` 只接受 registry 已登记包，不再回退到手工放置目录；命中记录时校验 target 与当前 host 一致。`configureInstance` 同样校验 registry target。
- G2-6 提供库级 API 与表单，不实现 `atom gateway` CLI；CLI 接线归 G3。
- `removePackage` 只删除 registry 记录并检查引用，不删除包目录；完整卸载归 G5。
- 已知项：secret 编辑态遮罩归 G4，详见 plan §4.4；gateway 端口 0 与 registry 锁在 M2.1 修复。

## 15. M2.1 风险硬化（2026-11-15）

| 事项 | 产出 | 测试结果 |
|---|---|---|
| gateway 端口延迟绑定 | `ClientManager` 向 supervisor 传 `() => config.port`；spawn 时读取实际端口；`startGateway` 可注入 `clientRuntime` | `bun test src/packages/gateway/src/client-manager src/packages/gateway/src/server.test.ts` → 52 pass；`startGateway({port:0})` 断言 `--gateway-url http://127.0.0.1:4321` |
| registry 跨进程锁 | shared `utils/file-lock.ts`；client-instance 与 registry 共用；registry `packages.lock` 有界重试/超时 | file-lock 5 pass、client-instance 18 pass、registry 17 pass；含跨进程并发注册/同版本冲突/锁超时 |

额外验证：

- `bun test src/packages/gateway/src src/packages/shared/src/config src/packages/shared/src/utils` → 260 pass / 1 skip
- `bun test src/packages/config-tui/src src/bootstrap/gateway-package.e2e.test.ts src/bootstrap/config.test.ts` → 112 pass
- `bun run typecheck`、`bun run typecheck:node`、`bun run docs:check`、`git diff --check` → 通过

实现说明：

- `withFileLock` 默认 fail-fast；registry 默认 5s 超时、25ms 重试，超时错误包含锁路径。
- 不自动回收 stale lock；崩溃遗留锁需人工清理。
- registry 写入仍使用 `writeFileAtomic`；锁只覆盖 read-modify-write。
- M2.1 不进入 G3/G4/G5。

## 16. M3a 实施记录（G3，2026-11-15）

| 子任务 | 实际产出 | 测试 |
|---|---|---|
| G3-1/G3-2/G3-10 | `ClientManager` 动态 register/remove/reload/status；活动端口集合；每实例队列；supervisor 替换；`stopAll` 等待队列并遍历实际 supervisor | `bun test src/packages/gateway/src/client-manager` → 67 pass |
| G3-3/G3-4/G3-5/G3-6 | `GET /admin/clients`、`GET /admin/clients/:id/diagnostics`、`POST reload`、drain 503/409、`DiagnosticsStore`、可选 Client `/diagnostics`（20 checks/200 字符/8 KiB 限界） | `bun test src/packages/gateway/src/server.admin.test.ts` → 5 pass；diagnostics 10 pass |
| G3-7 | Telegram `gateway-client.ts`、`update-loop.ts`、`diagnostics.ts`；503/429 分类、offset 不推进、`/diagnostics` | `bun test clients/telegram-bot/src` → 14 pass |
| G3-8 | `atom gateway <action>` 解析；旧 `--mode gateway` 保留 | `bun test src/bootstrap/cli.test.ts` → 42 pass |
| G3-9 | `gateway-command.ts` 离线 install/load/pack/uninstall；在线 list/start/stop/reload/check/logs | `bun test src/bootstrap/gateway-command.test.ts` → 6 pass |
| G3-10 | 并发/端口/drain/旧 timer/Secret 回归 | client-manager + server.admin 定向测试 |

实现说明：

- `main.ts` 在 Core 初始化前分流 `gatewayCommand`；在线 reload 由 `main.ts` 注入 `resolveClient`，重新读取 sandbox config/.env、registry 与 manifest。
- Gateway 包不读取 sandbox 配置；诊断事件有界 50 条并脱敏 UUID/截断。
- Client `/diagnostics` 二次限界：最多 20 checks、字段 200 字符（`at` 64）、总 JSON 8 KiB、仅保留 `name|ok|at|detail`，未知字段丢弃，常见 Token/Secret/UUID 形态脱敏。
- 管理接口仍使用本机管理 Token；GET 状态不包含 secret。
- `atom gateway load` 的相对路径按当前 cwd 解析（`GatewayCommandDeps.cwd` 可注入），写入绝对目录；`pack`/`install` 同样按 cwd 解析。
- G4 的 GatewayModal、菜单、日志 UI 未实现；G5 卸载文件清理未实现。

额外验证：

- `bun test src/packages/gateway/src src/packages/shared/src/config src/packages/shared/src/utils` → 287 pass / 1 skip
- `bun test src/bootstrap/cli.test.ts src/bootstrap/gateway-command.test.ts src/bootstrap/gateway-package.e2e.test.ts clients/telegram-bot/src` → 63 pass
- `bun run typecheck`、`bun run typecheck:node`、`bun run docs:check`、`git diff --check` → 通过

---

## 17. M3b 实施记录（G4，2026-11-15）

| 子任务 | 实际产出 | 测试 |
|---|---|---|
| G4-1/G4-2/G4-5 | `GatewayModal` 列表/操作/check/logs；`gateway-status.ts` 管理请求与保存；reload 错误 detail | `bun test src/packages/config-tui/src/components/GatewayModal.test.tsx` → 5 pass；`gateway-status.test.ts` → 8 pass |
| G4-3 | `GatewayInstanceForm` 编辑模式、configured secret、外部错误；`SecretFieldInput` 真遮罩 | `bun test src/packages/config-tui/src/gateway-instance-form.test.ts` → 22 pass |
| G4-4 | shared `runtime-file.ts`；bootstrap 复用；离线 `OFFLINE` | `bun test src/packages/shared/src/runtime-file.test.ts` → 3 pass |
| G4-6 | 菜单 install/load/manage/pack；history 新字段；命令预览安全引用 | `bun test src/bootstrap/menu-flow.test.ts src/bootstrap/menu-history.test.ts` → 53 pass |
| G4-7 | PTY：gateway 菜单导航/取消、窄窗口、reload 失败重试、非交互失败 | `ATOM_RUN_STARTUP_VALIDATION=1 bun test src/bootstrap/startup.integration.test.ts -t "gateway"` → 4 pass |
| 硬性 CLI | `atom gateway load --id`；resolver enum/default；secret 拒绝进入 clientArgs | `bun test src/bootstrap/cli.test.ts src/bootstrap/gateway-command.test.ts` → 50 pass；resolver+integration → 23 pass / 1 skip |

实现说明：

- `load` 使用 `command.id ?? manifest.id`；同一目录可用不同 ID 并存，同一 ID 经 `upsertInstance` 显式替换。
- resolver 对可选非 secret 字段应用 manifest `default`；`clientArgs` enum 在启动前校验；secret 字段必须走 `credentials`。
- `ClientStatus` 增加 `config` / `clientArgs` / `secretFields` / `stdio`；只含字段名与引用，不含 secret 值。
- UI 的 start/stop/reload 走 admin API；install/load/pack 复用 CLI handler（`GatewayCommandDeps.cwd` 语义不变）。
- 日志/诊断仍在 Gateway 侧有界脱敏（50 events / 5 summary / 20 checks / 8 KiB）；UI 只显示最近 12 条本地事件。
- 已知边界：manifest 暂无字段条件显示契约，表单展示全部声明字段；条件字段留待 manifest 扩展。G5 的卸载文件清理未实现。

### 17.1 M3b 初审修复（2026-11-15）

| 修复项 | 文件 | 行为 |
|---|---|---|
| 动态登记 | `server.ts`、`gateway-command.ts`、`gateway-actions.ts` | `POST /admin/clients {action:"register",clientId}` 调 resolver + `cm.register`，不 start；重复 409；其他失败 400。`gateway load` 在线 register，离线 saved/not started；JSON `saved/registered/offline`。 |
| client key 冲突 | `GatewayModal.tsx` | client item key 使用 `client:${id}`，激活时解析；固定动作 key 不再被实例 ID 覆盖。 |
| admin 超时 | `gateway-status.ts` | status/diagnostics/action 统一 `AbortSignal.timeout`（默认 5000ms）；超时错误明确。 |

测试：

- `bun test src/packages/gateway/src/server.admin.test.ts`：register 成功/重复/失败/start。
- `bun test src/bootstrap/gateway-command.test.ts`：离线 load、在线 register、register 失败输出。
- `bun test src/packages/config-tui/src/components/GatewayModal.test.tsx`：`refresh/back` 实例 ID、load 后刷新可见。
- `bun test src/packages/config-tui/src/gateway-status.test.ts`：超时错误。

---

## 18. G5 官方获取、升级与卸载（计划）

| 模块 | 文件 | 职责 |
|---|---|---|
| 来源索引 | `src/packages/gateway/src/client-package/source-index.ts` | v1 schema、file/http 加载、语义版本/target 选择、索引条目生成与安全合并 |
| 来源 URL 策略 | `src/packages/gateway/src/client-package/source-url.ts` | HTTPS 或 loopback HTTP 校验 |
| 下载校验 | `src/packages/gateway/src/client-package/download.ts` | 临时文件、超时、大小上限、流式 sha256；失败清理 |
| 来源安装 | `src/packages/gateway/src/client-package/source-install.ts` | 索引 + 下载 + 复用 `installClient`；已安装版本复用 |
| 升级编排 | `src/bootstrap/gateway-upgrade.ts` | 指定实例 package ref 更新、在线 apply、失败恢复旧配置 |
| 卸载清理 | `src/packages/gateway/src/client-package/registry.ts` | 引用检查 + registry 与包目录提交式删除 |
| 发布脚本 | `scripts/gateway-release.ts` | 当前 host 构建/打包 + sha256/size + 索引条目；要求显式 base URL |
| CLI | `src/bootstrap/cli.ts` / `gateway-command.ts` | `install <id>[@version]`、`upgrade`、`uninstall`、`--source`/`--version` |
| 测试 | gateway package + bootstrap e2e | 本地 HTTP fixture、坏 checksum/404/超时/target、升级回滚、引用保护 |

关键接口：

```ts
loadSourceIndex(location: string, options?): Promise<SourceIndex>;
selectSourceEntry(index, { id, version?, target }): SourceIndexEntry;
downloadVerifiedArtifact(entry, { fetchImpl?, timeoutMs?, maxBytes? }): Promise<{ path; sha256; size; cleanup }>;
installSourcePackage(sandbox, id, options?): Promise<{ record; entry?; cached: boolean }>;
upgradeClientInstance(sandbox, instanceId, version, { apply? }): Promise<UpgradeResult>;
```

`installClient` 增加可选 source label，使官方安装的 registry `source` 记录来源 URL，而不是临时下载路径。

**实施结果（2026-11-15）**

| 子任务 | 测试 |
|---|---|
| G5-1/G5-3 | `bun test src/packages/gateway/src/client-package/source-index.test.ts scripts/gateway-release.test.ts` → 14 pass |
| G5-2 | `bun test src/packages/gateway/src/client-package/download.test.ts` → 7 pass |
| G5-4 | `bun test src/packages/gateway/src/client-package/source-install.test.ts src/bootstrap/gateway-upgrade.test.ts` → 9 pass |
| G5-5 | `bun test src/packages/gateway/src/client-package/registry.test.ts` → 23 pass |
| G5-6 | `bun test src/bootstrap/gateway-official.e2e.test.ts` → 2 pass |
| 定向回归 | `bun test src/bootstrap/cli.test.ts src/bootstrap/gateway-command.test.ts ...` → 118 pass |

实现说明：

- 下载归档的 `sha256` 与 registry 的 payload `sha256` 分属两层；官方安装输出同时保留 registry `sha256`、`url`、`archiveSha256`。
- 升级失败只回滚实例 package ref；已安装的新版本保留，旧版本仍可用于回滚。
- 卸载不删除 `.env`、credentials、开发源码或会话数据。
- `gateway list` / config-only 行为保持 M3b 契约。
- 发布脚本未提交任何生产 URL 或伪 checksum；当前 host 的 Telegram 制品需在部署时提供真实 `--base-url` 并上传归档。

**G5 初审修复（2026-11-15）**

| 修复 | 文件 | 测试 |
|---|---|---|
| HTTPS/loopback URL 策略 + 流式索引限制 | `source-url.ts`、`source-index.ts`、`download.ts` | 公网 HTTP 拒绝、loopback 允许、content-length/无 length 超限拒绝 |
| 发布索引按 `id@version/target` 合并 | `source-index.ts`、`scripts/gateway-release.ts` | 两 target 合并、重复幂等、同键冲突拒绝 |
| reload 旧 supervisor 恢复 | `client-manager/index.ts` | 新版本 spawn 失败 → 旧版本重新 running；旧版本也失败 → 双失败报告 |
| 升级 apply 失败 | `gateway-upgrade.ts` + reload | config 回滚 + 旧进程恢复；e2e 验证旧版本可用 |

### 17.2 M3b 复审修复：config-only 闭环（2026-11-15）

| 修复项 | 文件 | 行为 |
|---|---|---|
| config-only 合并 | `gateway-status.ts`、`GatewayModal.tsx` | `listInstances(sandbox)` 与 supervisor 状态按 id 合并；config-only 为 `registered:false`、`state:"unregistered"`、`running:false`，不伪造 port/platform。 |
| manifest 元数据桥 | `gateway-actions.ts`、config-tui `index.ts` | `GatewayInstanceActions.describe(id)` 从目录或 registry manifest 读取 `config/clientArgs/secretFields/stdio/platform`；config-tui 不直接依赖 gateway。 |
| config-only 操作 | `GatewayModal.tsx` | 提供 Edit / Register / Pack（目录） / Back；register 成功刷新后显示 Start/Stop/Reload/Check/Logs。 |
| CLI list 合并 | `gateway-command.ts` | `gateway list` 离线读 config；在线合并 admin 状态。文本与 JSON 增加 `configured`、`registered`、`offline`。 |
| 测试 | `GatewayModal.test.tsx`、`gateway-status.test.ts`、`gateway-actions.test.ts`、`gateway-command.test.ts` | 覆盖离线 load → configured → 填 secret → register → start、目录/package describe、离线/在线 list。 |
