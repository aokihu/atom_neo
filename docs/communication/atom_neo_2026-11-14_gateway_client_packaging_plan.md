# Atom Neo — Gateway Client 打包接入开发计划

> 项目：`atom_neo`
> 日期：2026-11-14
> 开发目标：`gateway_client_packaging`
> 状态：**G0 已确认（D1–D9 全部采用推荐方案）；M1（G1）、M2（G2）、M2.1 已实施完成；G3–G6 待实施**。
> 本版已按复杂度规则将复杂阶段拆分为“中/轻”子任务；2026-11-15 修订：启动方式**不再兼容旧 `binary`**。决策与回写记录见 §4.2 与 §10。
>
> 关联文档：
> - [接入与发行规划](./gateway-client-design.md) — 目标、manifest、包与实例边界
> - [高层开发计划](./gateway-development-plan.md) — 原始 G0–G6 拆分
> - [Gateway 当前设计](./gateway.md)、[Telegram 当前实现](../clients/telegram-bot.md)
> - [配置系统](../subsystems/configuration.md)、[启动菜单](../subsystems/startup-menu.md)、[Sandbox](../subsystems/sandbox.md)
> - 文件级改动见 [code_and_file](./atom_neo_2026-11-14_gateway_client_packaging_code_and_file.md)
> - 关系图见 [graph](./atom_neo_2026-11-14_gateway_client_packaging_graph.md)

---

## 1. 背景

当前 Gateway 只支持在 `config.json` 中手写 `gateway.clients`：

```jsonc
{
  "gateway": {
    "clients": [{
      "id": "telegram-bot",
      "platform": "telegram",
      "binary": "/path/to/telegram-bot",
      "clientArgs": { "bot-token": "...", "mode": "longpoll" }
    }]
  }
}
```

限制：

- 用户必须自行构建二进制并填写绝对路径。
- 没有标准包、版本、目标平台和安装记录。
- 没有开发目录加载与重载流程。
- 平台接入只能在配置文件中维护，缺少检查、诊断与状态展示。
- Telegram Client 当前不检查 Gateway 入站响应的非 2xx 状态，重载时的忙/拒收可能被误当成已消费。

目标是把接入收敛为：

> **安装 Client 包 → 填写账号配置 → 检查连接 → 启用**
>
> 开发时：**加载目录 → 修改源码 → 重新加载 → 打包发行**

---

## 2. 目标与完成口径

### 2.1 第一轮交付（可独立验收）

1. Telegram 本地标准包安装
2. 开发目录加载与手动重载
3. 实例配置与连接诊断
4. 基本 CLI / 平台接入界面
5. 旧 `binary` 配置**不再兼容**；升级后需重新登记为包或目录实例，启动时明确报错

### 2.2 完整交付

在第一轮基础上增加：

- 官方名称安装、URL 下载、升级、卸载
- 多版本并存与显式切换
- 多账号边界按 G0 决策验收
- 完整文档与验证矩阵

### 2.3 不包含

- 插件市场、权限沙箱、通用热更新框架
- 新消息队列或 exactly-once 投递承诺
- shell 字符串拼接启动
- 旧 `binary` 配置自动迁移（不兼容，需手动重新登记）
- 自动文件监听（首版仅手动重载）
- 非 Telegram 平台 Client 的完整实现

---

## 3. 设计前提

以下契约以 [接入与发行规划](./gateway-client-design.md) 为基线，G0 负责最终收口：

- 三类对象：Gateway 服务、Client 程序包、接入实例。
- `manifest.json` 位于 Client 根目录，v1 六个必填字段：`manifest_version`、`id`、`name`、`version`、`platform`、`entry`。
- `entry` 至少包含 `production` / `development` 之一；开发目录只走 `development`，发行包只走 `production`。
- 以 Client 根目录为 cwd；命令数组直接传 `spawnProcess`，不拼 shell。
- Gateway 在入口后追加 `--secret`、`--port`、`--gateway-url` 与账号参数；入口不能覆盖内部保留参数。
- 包格式为 tar.gz，归档根目录直接放 `manifest.json` 与 `bin/`。
- 实例配置继续归属用户 `config.json`；凭据只存 `.env`，实例保存变量名引用。
- `directory` 可为绝对路径；相对路径在 Gateway 启动时相对 sandbox 根目录解析（`resolveClients({ baseDir })`）。G2 的 CLI/向导应写入绝对路径。
- 启动前校验 `manifest.config.required`：secret 字段必须有 `credentials` 引用，非 secret 字段必须有同名 `clientArgs` 参数；`enum`/`default` 由 G2 配置表单使用。
- 复用 `ProcessSupervisor`、共享 `HttpServer`、`spawnProcess`、`createChildProcessEnv`、配置 schema 与启动菜单。

---

## 4. 阶段计划

### 4.0 复杂度与拆分规则

**目的**：复杂阶段不能作为一个实施单元直接开工；必须先拆成可独立实现、独立验证的“中”或“轻”子任务。

| 等级 | 判定标准 | 实施要求 |
|---|---|---|
| **轻** | 1–2 个文件；局部逻辑；不跨模块、不涉及进程生命周期/并发/安全边界；≤0.5 天 | 可直接实施 |
| **中** | 3–5 个文件；一个模块边界；需要定向测试；0.5–1.5 天 | 可直接实施 |
| **复杂** | 超过 5 个文件，或跨两个以上模块，或涉及进程生命周期、并发、持久化、安全边界；>1.5 天 | **禁止直接实施**，必须继续拆分 |

拆分规则：

1. 每个子任务必须有唯一 ID、明确产出、依赖和验收条件。
2. 子任务按“可独立提交、可独立验证”的粒度拆分；不能独立验证就继续拆。
3. 单个子任务不得标为“复杂”；发现升级为复杂时暂停，重新拆分。
4. 涉及并发、安全、持久化、跨进程的子任务必须配套 fake runtime、临时 sandbox 或并发测试。
5. 阶段完成 = 所有子任务完成，不是主路径跑通。
6. 子任务产出文件与示例代码见 [code_and_file](./atom_neo_2026-11-14_gateway_client_packaging_code_and_file.md)；运行关系见 [graph](./atom_neo_2026-11-14_gateway_client_packaging_graph.md)。

### 4.1 阶段复杂度评估

| 阶段 | 复杂度 | 原因 | 拆分后子任务数 |
|---|---|---|---|
| G0 契约收口 | 中 | 决策多、跨文档，但无运行时改动 | 6 |
| G1 manifest 与启动描述 | **复杂** | 跨 shared/gateway，涉及配置替换与凭据 | 7 |
| G2 本地包闭环 | **复杂** | 跨包格式、归档安全、配置写入与 Client | 8 |
| G3 动态加载与重载 | **复杂** | 进程生命周期、并发、drain、Secret、端口 | 10 |
| G4 管理与诊断 | **复杂** | 跨 TUI/CLI/Gateway/Client，状态来源多 | 7 |
| G5 官方分发 | **复杂** | 下载、校验、版本切换、失败恢复、引用保护 | 6 |
| G6 集成收口 | 中 | 文档、验证与发布，跨多个已有模块 | 5 |

#### 4.1.1 子任务依赖

```text
G0: G0-1 → G0-2 → G0-3 → G0-4 → G0-5 / G0-6

G1: G1-1 ─┬→ G1-2
          ├→ G1-3 → G1-4 → G1-6 → G1-7
          └→ G1-5 ────────↗

G2: G2-1 → G2-2 → G2-3 → G2-5 → G2-8
     G2-1 → G2-4 ────────↗
     G2-1 → G2-7 → G2-8
     G2-6 ────────↗

G3: G3-1 → G3-2 → G3-4 → G3-5 → G3-10
     G3-3 ────────↗
     G3-6 → G3-3
     G3-8 → G3-9 → G3-10
     G3-7 ────────↗

G4: G4-4 → G4-1 → G4-2 → G4-3
     G4-1 → G4-5
     G4-6 → G4-7
     G4-2 → G4-7

G5: G5-1 → G5-2 → G5-4 → G5-6
     G5-3 ────────↗
     G5-5 ────────↗

G6: G6-1 → G6-2 → G6-3 → G6-4 → G6-5
```

**可并行子任务**

| 波次 | 可并行项 | 说明 |
|---|---|---|
| W1 | G1-1、G1-3、G1-5 | schema、manifest、env 过滤互不依赖 |
| W2 | G2-2、G2-4、G2-6 | pack、registry、离线配置可并行 |
| W3 | G3-1、G3-3、G3-7、G3-8 | 动态 manager、查询接口、Telegram 修复、CLI 解析可并行 |
| W4 | G4-4、G4-5、G4-6 | 状态读取、诊断展示、菜单可并行 |
| W5 | G5-1、G5-3、G5-5 | 来源映射、制品、卸载保护可并行 |

> 同一文件的改动仍需串行合并；并行只表示任务可独立开发与验证。

### 4.2 G0：契约收口

**依赖**：无。
**复杂度**：中。
**目标**：在写代码前固定所有会阻塞实现的契约。

| ID | 子任务 | 复杂度 | 产出 | 验收 |
|---|---|---|---|---|
| G0-1 | 核对 2026-11-14 工作区代码基线 | 轻 | ClientManager、ProcessSupervisor、config、menu 现状清单 | 已完成 |
| G0-2 | 编写三份开发文档 | 中 | plan / code_and_file / graph | 已完成；`docs:check` 通过 |
| G0-3 | 确认 D1–D9 决策 | 轻 | 决策结论 | 已完成（2026-11-15 用户确认全部采用推荐方案） |
| G0-4 | 将确认结果回写 plan 与 design | 中 | 更新后的契约 | 已完成；D1–D9 结论见下表 |
| G0-5 | 更新 `docs/index.md` 三份文档入口 | 轻 | 索引行 | 已完成；M1 文案已同步 |
| G0-6 | 在 `gateway.md` 规划段落补充三份执行文档链接 | 轻 | 设计文档入口 | 已完成；链接可达并与 `index.md` 一致 |

#### G0 待确认决策

| 编号 | 决策 | 推荐方案 | 备选/影响 |
|---|---|---|---|
| D1 | manifest v1 是否严格拒绝未知字段 | `.strict()`；新增字段必须提升 `manifest_version` | 放宽可前向兼容，但拼写错误会被静默忽略 |
| D2 | 实例配置 schema 形态 | 单一对象 + `superRefine`，要求 `package` / `directory` 恰好一个；移除 `binary` 与 `platform`，platform 由 manifest 解析 | 保留 `binary` 会形成第二套启动来源，本轮已明确移除 |
| D3 | 包登记文件结构 | `.atom/gateway/packages.json`，`{ version: 1, packages: { [id]: { [version]: PackageRecord } } }` | 目录扫描推断版本，启动慢且易受手工改动影响 |
| D4 | `config.json` / `.env` 写入所有者 | 仅本机 CLI / 配置向导写入；Gateway 只读并重载。使用 lockfile + `.atom/gateway/state.json` 的 `configRevision` 防止并发覆盖 | Gateway 代写需要跨进程锁，权限边界更复杂 |
| D5 | 重载 drain 协议 | 每实例在途计数；drain 期间 `/gateway/inbound` 返回 503；Telegram 对 503/429 退避重试；默认 30s 超时，超时保留旧进程 | 直接强杀简单但会丢结果 |
| D6 | 同平台多账号会话隔离 | 首版保持 `platform:platformUserId` 与冲突拒绝；完整多账号另行设计迁移 | 新规则会影响旧会话恢复与 TUI 默认会话 |
| D7 | CLI 语法与退出码 | 新增 `atom gateway <install|load|reload|list|start|stop|check|logs|pack|uninstall>`；旧 `--mode gateway` 保留；部分失败退出码 1 | 复用 `--mode gateway` 扩展动作会混淆短时控制与服务发现 |
| D8 | pack 输出与归档依赖 | 默认 `./dist/<id>-<version>-<target>.tar.gz`；新增 `tar` 依赖，禁止 shell 拼 tar | 调用系统 tar 少依赖，但跨平台行为不一致 |
| D9 | Client 诊断协议 | 新增可选 `GET /diagnostics`；未实现该端点的 Client 返回 404 显示 `unsupported`；不把 `/health` 当作凭据有效 | 仅 `/health` 无法区分平台认证失败 |

**G0 决策结论（2026-11-15 确认）**

D1–D9 全部采用上表“推荐方案”，无附加条件：

| 编号 | 确认结论 | 落点 |
|---|---|---|
| D1 | manifest v1 使用严格模式；未知字段必须提升 `manifest_version` | `client-package/manifest.ts` |
| D2 | 实例配置只接受 `package` / `directory` 恰好一个；移除 `binary` / `platform`；platform 取自 manifest | `shared/config/client.ts` |
| D3 | 包登记使用 `.atom/gateway/packages.json`，结构 `{version:1, packages:{id:{version:PackageRecord}}}` | G2 `client-package/registry.ts` |
| D4 | 仅本机 CLI / 配置向导写 `config.json` / `.env`；lockfile + `state.json.configRevision` 防并发覆盖；Gateway 只读 | `shared/config/client-instance.ts` |
| D5 | 每实例在途计数；drain 期间 `/gateway/inbound` 返回 503；默认 30s 超时，超时保留旧进程 | G3 `server.ts` |
| D6 | 首版保持 `platform:platformUserId` 会话 ID 与冲突拒绝；多账号另行设计迁移 | 现有 Core / Gateway 行为不变 |
| D7 | 新增 `atom gateway <install\|load\|reload\|list\|start\|stop\|check\|logs\|pack\|uninstall>`；保留 `--mode gateway`；部分失败退出码 1 | G3 `bootstrap/cli.ts` |
| D8 | pack 输出 `./dist/<id>-<version>-<target>.tar.gz`；新增 `tar` 依赖，禁止 shell 拼 tar | G2 `client-package/archive.ts` |
| D9 | 新增可选 `GET /diagnostics`；404 显示 `unsupported`；`/health` 不等于平台凭据有效 | G3/G4 Client 与 Gateway |

**G0 完成标准**：D1–D9 全部有明确结论；现有行为与目标行为分开描述；多账号未决前不宣称完整多账号可用。

---

### 4.3 G1：manifest 解析与统一启动描述

**依赖**：G0。
**复杂度**：**复杂**，已拆为 7 个中/轻子任务。
**目标**：所有 Client 最终都变成 `ResolvedClientConfig`，supervisor 不再理解 manifest。

| ID | 子任务 | 复杂度 | 产出 | 验收 |
|---|---|---|---|---|
| G1-1 | 改造 `ClientConfigSchema`：`package` / `directory` 二选一、`credentials`、移除 `binary` / `platform` | 中 | `shared/client.ts` + 测试 | 缺失/双来源报错；`binary` 配置明确拒绝并提示改用包或目录 |
| G1-2 | 实例配置读写与 revision | 中 | `client-instance.ts` + 测试 | 原子写、lockfile、取消不落盘、`configRevision` 递增 |
| G1-3 | manifest v1 schema、解析、入口选择 | 中 | `manifest.ts` + 测试 | 六字段；strict；未知版本拒绝；production/development 分支正确 |
| G1-4 | 用户配置 → 可启动描述（command/cwd/platform） | 中 | `resolver.ts` + 测试 | package/directory 两路径正确；platform 取自 manifest；保留参数不被覆盖 |
| G1-5 | 凭据引用到子进程 env，并过滤其他实例 | 轻 | `child-process-env.ts` + 测试 | 仅注入目标实例；`ATOM_ADMIN_TOKEN` 与其他 `ATOM_CLIENT_*` 不出现 |
| G1-6 | `client-command` / `ProcessSupervisor` 接入 `ResolvedClientConfig` | 中 | 两个文件 + 测试 | 新配置行为正确；cwd/env 正确传递 |
| G1-7 | G1 集成测试（fake runtime） | 中 | 测试文件 | 目录/包均可启动；不启动真实进程 |

**M1 实施状态（2026-11-15）**

| ID | 状态 | 实际产出 |
|---|---|---|
| G1-1 | 已完成 | `shared/config/client.ts`；`config.test.ts` 通过 |
| G1-2 | 已完成 | `shared/config/client-instance.ts`；18 个测试通过（含回滚与引用冲突）；lockfile + `configRevision` |
| G1-3 | 已完成 | `gateway/client-package/manifest.ts` + README；17 个测试通过 |
| G1-4 | 已完成 | `gateway/client-package/resolver.ts`；17 pass / 1 skip；package/directory、相对目录 baseDir、required 校验 |
| G1-5 | 已完成 | `shared/utils/child-process-env.ts`；7 个测试通过；实例凭据隔离 |
| G1-6 | 已完成 | `client-command` / `process-supervisor` / `client-manager` / `server` / `main` 接入 `ResolvedClientConfig`；57 个定向测试通过 |
| G1-7 | 已完成 | fake runtime 集成测试覆盖 package、directory、旧 binary 拒绝、凭据隔离与保留参数；5 个测试通过 |

**G1 完成标准**：

- 包与开发目录都能通过 fake runtime 启动。
- 开发目录不需要 production 产物；发行包不能误走 development。
- 未使用 shell 拼接，未新增生命周期管理器。

---

### 4.4 G2：本地安装、打包与离线配置闭环

**依赖**：G1。
**复杂度**：**复杂**，已拆为 8 个中/轻子任务。
**目标**：完成“构建 → pack → install → 配置 → fake 往返”的本地闭环。

| ID | 子任务 | 复杂度 | 产出 | 验收 |
|---|---|---|---|---|
| G2-1 | Telegram manifest 与构建产物路径 | 轻 | `manifest.json`、`package.json` | `entry.production` 指向 `bin/telegram-bot`；构建后存在 |
| G2-2 | pack：manifest 校验、文件收集、敏感内容排除 | 中 | `archive.ts` pack + 测试 | 只收 manifest/bin 白名单；`.env`/源码/依赖不进包 |
| G2-3 | 归档安全：路径越界、链接逃逸、临时目录 | 中 | `archive.ts` 校验 + 测试 | 恶意归档拒绝；失败清理临时目录 |
| G2-4 | 包登记：读写、幂等、版本冲突、引用检查 | 中 | `registry.ts` + 测试 | 原子写；同内容幂等；同版本不同内容拒绝 |
| G2-5 | install 流程：解包、校验、提交、回滚 | 中 | `archive.ts` install + 测试 | 失败不覆盖旧版本；成功登记版本目录 |
| G2-6 | 离线实例配置（CLI） | 中 | `client-instance.ts` + 命令测试 | 保存成功显示“未启动”；取消不创建实例 |
| G2-7 | 首次实例配置表单（config-tui） | 中 | `GatewayInstanceForm.tsx` + 测试 | manifest.config 驱动；secret 遮罩；enum 选择与 default 预填在表单应用；required 与 resolver 启动校验一致 |
| G2-8 | 本地闭环端到端测试 | 中 | 临时 sandbox 测试 | 构建 → pack → install → 配置 → 启动 → fake 往返通过 |

**M2 实施决策（2026-11-15）**

- D8：在 `@atom-neo/gateway` 新增 npm `tar` 依赖；pack/install 均使用库 API，不拼 shell `tar` 命令。
- pack 白名单：只收集 `manifest.json` 与 `bin/**`；`.env`、`src/`、`node_modules`、日志、`dist` 不进入归档。`bin/` 内符号链接拒绝。
- target：pack 使用显式 `target`、manifest.target 或当前 `${process.platform}-${process.arch}`；写入归档 manifest。install 校验归档 target 与当前主机一致，不支持时明确报错。
- 默认 pack 输出：Client 根目录下 `dist/<id>-<version>-<target>.tar.gz`；`out` 可覆盖。
- registry：沿用 D3 `{version:1, packages:{id:{version:PackageRecord}}}`；`PackageRecord` 增加 `sha256` 内容标识，以满足“同内容幂等、同版本不同内容拒绝”。删除前检查 `gateway.clients[].package` 引用。
- 包查找由 registry 接管：`sandboxPackageRoot` 只接受已登记包，不再回退到手工放置目录；命中记录时校验 `record.target` 必须等于当前 host target。离线配置 API 同样校验 registry target。
- install：解包到 `.atom/gateway/tmp`，校验路径/链接/manifest/target/production 入口后原子提交到 `packages/<id>/<version>/<target>`；已有版本拒绝覆盖；registry 写入失败时清理已提交目录。
- 离线配置：`gateway/client-package/instance-config.ts` 复用 shared `client-instance` 写入，返回 `saved / applied=false`；不在 M2 实现 `atom gateway` CLI。
- config-tui 表单只依赖 shared/tui-kit 类型，不导入 gateway；manifest.config 以结构化 prop 传入，enum/default 由表单应用。
- G2-8 使用临时 sandbox、编译的 fake Client 与 fake Core 完成闭环，不要求用户手写 binary 路径。

**M2 实施状态（2026-11-15）**

| ID | 状态 | 实际产出 |
|---|---|---|
| G2-1 | 已完成 | `clients/telegram-bot/manifest.json`；构建输出 `bin/telegram-bot` |
| G2-2 | 已完成 | `client-package/archive.ts` pack 白名单、target 注入、敏感文件排除；archive 21 个测试通过（含 install） |
| G2-3 | 已完成 | archive 路径/链接/类型/临时目录安全校验 |
| G2-4 | 已完成 | `client-package/registry.ts`；11 个测试通过；`sha256` 内容标识 |
| G2-5 | 已完成 | `installClient` 解包、target/production 校验、提交与回滚 |
| G2-6 | 已完成 | `client-package/instance-config.ts`；10 个测试通过；`saved / applied=false` |
| G2-7 | 已完成 | `GatewayInstanceForm.tsx` + 纯逻辑；15 个测试通过 |
| G2-8 | 已完成 | 临时 sandbox build→pack→install→configure→start→fake roundtrip；1 个 e2e 测试通过 |

**M2 已知项（后续阶段处理）**

| 项 | 归属 | 说明 |
|---|---|---|
| secret 编辑态明文可见 | G4 | 当前列表行已遮罩，编辑时受 tui-kit FieldInput 限制；G4 实例表单实现真正的输入遮罩 |

**G2 完成标准**：临时 sandbox 中完成上述闭环，不要求用户手写 binary 路径；失败路径无半成品。

### 4.4.1 M2.1：风险硬化

**依赖**：M2。
**目标**：修复端口 0 的启动描述错误；为 registry 的 read-modify-write 增加跨进程锁。不进入 G3/G4/G5。

| ID | 事项 | 产出 | 完成条件 |
|---|---|---|---|
| M2.1-1 | gateway 端口延迟绑定 | supervisor 使用端口 getter；`startGateway` 在 `serve()` 后更新真实端口 | `startGateway({port:0})` + 已配置 Client 时，spawn 命令中的 `--gateway-url` 使用 serve 后的实际端口；不启动真实 Client |
| M2.1-2 | registry 跨进程锁 | shared `utils/file-lock.ts`；client-instance 与 registry 共用 | 有界重试/超时、明确错误；并发 register/remove 不丢更新；锁冲突/超时不破坏 registry；同内容幂等保持 |

**M2.1 决策**：

- 不延迟创建 ClientManager（避免 serve 早期请求拿到未初始化 manager）；改为 ClientManager 向 supervisor 传 `() => config.port`，spawn 时读取当前端口。
- `startGateway` 增加可注入 `clientRuntime`，用于端口 0 的 fake runtime 测试。
- 锁文件：`.atom/gateway/config.lock`（实例配置）与 `.atom/gateway/packages.lock`（registry）；registry 默认有界等待 5s、25ms 重试，超时明确报错。
- 不引入 stale-lock 自动回收；崩溃遗留锁需人工清理，沿用 M1 风险口径。
- `startGateway({port:0})` 与 registry 锁从“已知风险”移出，作为 M2.1 已解决项。

**M2.1 实施状态（2026-11-15）**

| ID | 状态 | 实际产出 |
|---|---|---|
| M2.1-1 | 已完成 | supervisor 端口 getter；`startGateway({port:0})` fake runtime 测试；e2e 改用 port 0（52 个 client-manager/server 测试通过） |
| M2.1-2 | 已完成 | shared `file-lock.ts`；registry `packages.lock` 有界重试/超时；file-lock 5 + client-instance 18 + registry 17 测试通过 |

**M2.1 完成条件**：`startGateway({port:0})` 的 spawn 命令使用 serve 后的真实端口；registry 并发 register/remove 不丢更新；锁冲突/超时明确报错且不破坏 registry；client-instance 既有行为保持不变。以上均已通过定向测试。

---

### 4.5 G3：在线目录加载与手动重载

**依赖**：G1、G2。
**复杂度**：**复杂**，已拆为 10 个中/轻子任务。
**目标**：Gateway 与 Core 不重启，只重载目标实例，且并发行为确定。

| ID | 子任务 | 复杂度 | 产出 | 验收 |
|---|---|---|---|---|
| G3-1 | ClientManager 动态登记/移除与端口分配 | 中 | `client-manager/index.ts` + 测试 | 活动端口不冲突；移除后释放；`stopAll` 遍历实际 supervisor |
| G3-2 | supervisor 替换与代际隔离 | 中 | reload 逻辑 + 测试 | 旧 exit 回调、旧 restart timer、旧 Secret 不影响新进程 |
| G3-3 | 管理接口 GET 列表、状态、诊断摘要 | 中 | `server.ts` + 测试 | 状态来源 supervisor；离线实例显示 idle |
| G3-4 | drain 计数、503、超时 | 中 | `server.ts` + 测试 | 在途归零后重载；超时 409 并保留旧进程 |
| G3-5 | reload 接口与 `resolveClient` 回调 | 中 | `server.ts`、`main.ts` 集成 + 测试 | 只重载目标；新进程失败不影响其他实例 |
| G3-6 | 诊断存储与可选 Client 协议 | 中 | `diagnostics.ts` + 测试 | 每实例有界；未实现 `/diagnostics` 的 Client 显示 unsupported |
| G3-7 | Telegram 非 2xx、503/429、offset 语义 | 中 | `gateway-client.ts` + 测试 | 忙/拒收不推进 offset；退避后重试 |
| G3-8 | CLI 子命令解析（不含处理器） | 中 | `cli.ts` + 测试 | 新旧命令不混用；非法参数无副作用 |
| G3-9 | `gateway-command` 离线/在线处理器 | 中 | `gateway-command.ts` + 测试 | 离线保存、在线操作、服务离线报错 |
| G3-10 | 并发回归：reload/health/stop/exit | 中 | 并发测试 | 无旧进程/计时器复活；无端口冲突；无残留 Secret |

**G3 完成标准**：

- 在途消息、健康重启、手动 stop 并发时行为确定。
- 新进程启动失败可见，其他实例继续工作。
- 源码变更本身不保证自动回滚。

---

### 4.6 G4：平台接入管理、诊断与日志

**依赖**：G2、G3。
**复杂度**：**复杂**，已拆为 7 个中/轻子任务。
**目标**：用户能在界面和 CLI 完成一次接入并区分三类状态。

| ID | 子任务 | 复杂度 | 产出 | 验收 |
|---|---|---|---|---|
| G4-1 | `GatewayModal` 实例列表与状态 | 中 | Modal + 测试 | 显示来源、版本/目录、进程状态、最近错误 |
| G4-2 | 安装/配置编辑/检查/启停入口 | 中 | Modal 操作 + 测试 | 操作结果逐项可见；取消无副作用 |
| G4-3 | 实例编辑表单与条件字段（复用 G2 表单） | 中 | `GatewayInstanceForm.tsx` 扩展 + 测试 | 编辑模式；webhook 高级字段按选择展示；secret 不回显 |
| G4-4 | 运行状态共享读取 | 轻 | shared `runtime-file.ts` + bootstrap 复用 | 路径/JSON 解析只有一份；离线显示 OFFLINE |
| G4-5 | 诊断与日志展示 | 中 | 状态/日志 UI + 测试 | 进程就绪、平台检查、消息往返三结果可区分；日志有界脱敏 |
| G4-6 | 菜单入口与参数记忆 | 轻 | `menu-flow.ts`/`menu-history.ts` | 不记录 Token/Secret；执行交接正确 |
| G4-7 | PTY 验收 | 中 | PTY 测试 | 键盘导航、取消、错误重试、窄窗口、非交互失败 |

**G4 完成标准**：

- 界面能独立完成一次接入。
- `/health` 不被当作平台凭据有效。
- 未实现诊断的 Client 显示未知/不支持，不误判为凭据失败。

---

### 4.7 G5：官方获取、升级与卸载

**依赖**：本地安装闭环；升级依赖 G3。
**复杂度**：**复杂**，已拆为 6 个中/轻子任务。
**目标**：官方名称安装、版本选择、失败恢复与引用保护端到端可验证。

| ID | 子任务 | 复杂度 | 产出 | 验收 |
|---|---|---|---|---|
| G5-1 | 官方名称到版本/target/URL/校验值映射 | 中 | 来源映射 + 测试 | 名称、版本、目标可追溯；未知目标提前报错 |
| G5-2 | 下载、校验并复用本地安装器 | 中 | 下载模块 + 测试 | 校验失败不落盘；不实现第二套安装流程 |
| G5-3 | 发布实际支持目标的 Telegram 制品 | 中 | 发布产物 | 未构建目标不列为已支持 |
| G5-4 | 新版本并存安装与显式切换 | 中 | 升级逻辑 + 测试 | 不自动切换全部实例；失败保留旧版本 |
| G5-5 | 卸载与引用保护 | 中 | 卸载逻辑 + 测试 | 被引用版本不可删；源码/凭据/会话不误删 |
| G5-6 | 官方分发端到端测试 | 中 | 测试记录 | 安装、版本选择、失败恢复、卸载保护通过 |

**G5 完成标准**：官方名称安装、版本选择、失败恢复与引用保护端到端可验证。

---

### 4.8 G6：集成收口与文档交付

**依赖**：G1–G5。
**复杂度**：中。
**目标**：能力、文档、CLI 帮助、索引和验收记录一致。

| ID | 子任务 | 复杂度 | 产出 | 验收 |
|---|---|---|---|---|
| G6-1 | 更新 Gateway、Telegram、配置、Sandbox、启动菜单、开发环境文档 | 中 | 设计文档 | 验收通过能力从规划迁入当前说明 |
| G6-2 | 更新索引、CLI 帮助、README 与包示例 | 轻 | 文档与帮助 | `docs:check` 通过；路径一致 |
| G6-3 | 执行验证矩阵 | 中 | 验证记录 | 命令、结果、运行时、制品齐全 |
| G6-4 | 记录已知限制与真实平台验收状态 | 轻 | 报告 | 未验证项明确标注 |
| G6-5 | 最终评审与交付确认 | 轻 | 确认记录 | 所有必需阶段通过后再标记完成 |

**G6 完成标准**：文档、CLI 帮助、索引、示例与实际行为一致；未做真实平台验证时明确标注。

---

## 5. 里程碑

| 里程碑 | 包含阶段 | 子任务数 | 可演示结果 |
|---|---|---|---|
| M1 基础描述 | G0、G1 | 13 | 包引用与开发目录都由统一描述启动；旧 `binary` 配置明确拒绝并提示迁移 |
| M2 本地闭环 | G2 | 8 | 构建 → pack → install → 配置 → fake 往返 |
| M3 在线管理 | G3、G4 | 17 | 不重启 Gateway 重载目标实例；列表、检查、诊断、日志 |
| M4 分发闭环 | G5、G6 | 11 | 官方安装、升级/卸载、完整文档与验收 |

第一轮交付 = M3 完成；完整交付 = M4 完成。

---

## 6. 验证矩阵

| 范围 | 必验场景 |
|---|---|
| manifest | 缺字段/未知版本、空命令、开发/生产入口、保留参数、target 不匹配 |
| 包 | 正常归档、损坏/越界/链接逃逸、同版本重复/冲突、敏感内容排除、失败无半成品 |
| 配置 | `binary` 配置明确拒绝、包/目录引用互斥、双实例不同凭据、取消/写盘失败回滚、并发修改冲突 |
| 凭据 | 在线重新读取、仅注入目标实例、管理 Token 过滤、CLI/日志/历史/包中不含凭据 |
| 生命周期 | load/reload/stop/health failure/exit 并发、无旧进程/计时器复活、Secret 撤销、端口不冲突 |
| 消息 | 空闲重载、在途 drain、超时保留旧进程、拒收后重试、新进程失败、其他实例不受影响 |
| 状态与诊断 | health 不能充当平台认证；未知/不支持可见；真实往返单独记录；日志有界 |
| CLI/UI | 源码与发行入口、新旧命令、离线/在线、非交互缺参数、PTY 导航/取消/重试 |
| 运行时 | Bun 与 Node Atom 入口；Telegram 开发入口单独检查 Bun；旧 HTTP adapter/管理鉴权回归 |
| 多账号 | 按 G0 决策验证同用户跨账号、旧会话恢复、发起者冲突、默认 TUI 选择 |

计划命令（**不代表本轮已执行功能验收**）：

```bash
bun run docs:check
git diff --check
bun test src/packages/gateway/src
bun test src/packages/shared/src/config
bun test src/bootstrap/cli.test.ts
bun run typecheck
bun run typecheck:node
bun run build:node
ATOM_RUN_STARTUP_VALIDATION=1 bun test src/bootstrap/startup.integration.test.ts
```

> Gateway 测试固定使用 `src/packages/gateway/src`：仓库可能残留被 `.gitignore` 忽略的 `src/packages/gateway/dist` 旧编译测试，`bun test src/packages/gateway` 会把它们一起执行并产生与当前源码无关的失败。dist 不作为验证来源。

假平台通过只证明协议链路；Telegram 凭据检查与真实消息往返需使用明确指定的测试账号单独记录。

---

## 7. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 移除 `binary` 导致旧配置无法启动 | 升级后实例不可用 | 启动时明确报错并提示改用 `package` / `directory`；不静默迁移；文档提供重新登记步骤 |
| 凭据进入日志/历史/包 | 账号泄露 | 只存 `.env` 引用；统一脱敏；pack 排除敏感文件；测试断言不出现 secret |
| 归档路径逃逸/链接逃逸 | 写入任意路径 | 解包前校验绝对路径、`..`、符号链接；临时目录提交 |
| 重载与健康重启/手动 stop 竞争 | 旧进程复活、重复端口 | 复用 supervisor 队列；实例代际检查；stopAll 遍历实际 supervisor |
| 端口按数组索引分配 | 动态增删后冲突 | 改为活动端口集合分配，移除实例后释放 |
| Telegram 把 503/429 当成功 | 消息丢失 | 检查 `res.ok`；忙/限流退避重试；不推进 update offset |
| Node/Bun 运行时差异 | 包在 Node 下不可用 | 明确 manifest entry 运行前提；Telegram development 入口要求 Bun；Node 仅验证 Atom 入口 |
| 多账号共享会话 | 跨账号串会话 | G0 明确边界；未解决前不宣称完整多账号 |
| UI 状态与真实进程不一致 | 误判已启用 | 状态来源统一为 supervisor；health 与平台检查分离 |
| 子任务再次膨胀为复杂 | 单任务失控、验收困难 | 按 4.0 规则暂停并继续拆分 |

---

## 8. 回滚策略

- 旧 `binary` 配置不再兼容，也不自动迁移；升级后启动必须报错并提示重新登记为包或目录实例。
- 包安装失败不覆盖已有版本；临时目录、登记记录、进程与计时器必须清理。
- 实例切换失败分别报告“配置已保存”和“进程未运行”，保留旧版本与旧实例配置。
- 开发重载失败可修正源码后重试，或停止开发实例；不得恢复已撤销的 Secret。
- 所有退出与失败路径清理其拥有的暂存目录、进程、计时器和日志句柄。
- 不通过放宽 Core runtime overlay 实现 Client 重载；Gateway 端口变更仍需重启。

---

## 9. 文档与代码交付

| 类型 | 内容 |
|---|---|
| 新增文档 | 本文、`code_and_file`、`graph` |
| 更新文档 | `gateway.md`、`gateway-client-design.md`、`gateway-development-plan.md`、`clients/telegram-bot.md`、`configuration.md`、`startup-menu.md`、`sandbox.md`、`index.md` |
| 新增 README | <code>src/packages/gateway/src/client-package/README.md</code>；如新增复杂目录再补 |
| 代码 | 见 [code_and_file](./atom_neo_2026-11-14_gateway_client_packaging_code_and_file.md) |
| 测试 | manifest、registry、archive、resolver、ClientManager 动态、server admin、CLI、配置 schema、Telegram 响应 |

---

## 10. 确认清单

实施前请确认：

- [x] 接受 4.0 复杂度拆分规则：复杂阶段必须拆为中/轻子任务
- [x] 接受 G1–G5 的子任务拆分、依赖与验收
- [x] 确认启动方式不再兼容旧 `binary`，升级后需重新登记实例
- [x] D1 manifest v1 严格模式
- [x] D2 实例配置 schema 方案
- [x] D3 包登记文件结构
- [x] D4 配置写入所有者与并发策略
- [x] D5 重载 drain 协议与超时
- [x] D6 多账号会话隔离边界
- [x] D7 CLI 语法与退出码
- [x] D8 pack 输出路径与归档依赖
- [x] D9 Client 诊断协议
- [x] 第一轮交付范围 = G0–G4（M3）
- [x] 是否按 G0 → G1 → G2 → G3 → G4 → G5 → G6 顺序实施

确认记录：2026-11-15 用户确认全部采用推荐方案，无附加条件。G0 契约回写完成后进入 M1（G0+G1）编码；G2 及以后阶段另行确认。
