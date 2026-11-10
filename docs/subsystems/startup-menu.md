# Startup Menu

v1.21.3 将已确认的启动向导、参数记忆、命令打印、导航说明和消息间距优化合并到 main；本次仅升级交付版本，不调整既有功能行为。

v1.21.2 改进原生菜单导航与帮助说明：完整路径、回退定位、步骤提示、选中项说明和参数填写帮助，并优化窄窗口显示。

v1.21.1 交付包含分层启动、参数历史、远程 attach 与执行前打印可复制命令；相对开发版本 v1.21.0 升级补丁版本。

`atom menu` 是一次性启动向导：普通终端文本、单列菜单、面包屑，不使用 App 主题。一级只有命令名称，不展示长参数。最后一步自动执行，成功后结束菜单并交给对应 App，不回主菜单。

```text
menu
├─ start > chat > sandbox > new / continue > Core + TUI
│        └ core > sandbox > host > port > Core
├─ config > sandbox > 现有配置编辑器
├─ gateway > run > sandbox > host > port > Core + Gateway
│          ├ start clients > sandbox > client ID / all > 启用
│          └ stop clients > sandbox > client ID / all > 停止
├─ attach > remote address > port > 连接并进入 TUI
├─ backup > export > sandbox > output > encrypt > 导出配置归档
│          └ import > archive > sandbox > 导入配置归档
└─ exit
```

## 交互与生命周期

上下选择，Enter 确认；Esc 回退并保留草稿，根层 Esc、Ctrl+C、Ctrl+D、EOF 取消。输入支持光标移动、删除、Home/End、Ctrl+A/E/U/W；多行粘贴不作为确认键。校验失败停在原步骤；执行失败重新打开当前路径的最后一步，可修改、重试或回退。成功前关闭菜单终端输入，随后才启动 App 渲染器。退出独立 TUI 不关闭被连接的 Core。

导航优化：保留单列命令列表，用终端反色标记当前选中项；不引入 App 主题。完整面包屑使用用户所选路径（如 `menu / gateway / run`），不暴露内部 `core-gateway` 等状态名。子菜单和会话选择提供 `‹ back`；返回父菜单时选中刚离开的项目。列表支持右键进入、左键返回、Home/End 首尾定位，输入框左右键仍用于编辑。参数标题显示 `[当前步骤/总步骤]`；最后一步明确提示 Enter 执行，根菜单 Esc 提示为退出。终端尺寸改变时重新排版，超长路径标题使用省略号保持输入框位置，输入值超宽时水平滚动显示光标附近内容；重绘只清理当前行与残留内容，避免逐键清空整个屏幕。

说明文案：一级菜单、子菜单和会话选择在列表下方固定预留两行低强调说明，跟随选中项切换，解释用途与执行结果；窄窗口按显示宽度换行，超过两行时在末尾省略。菜单项的名称、目标与说明由同一份条目数据持有，避免列表和路由顺序分离。参数标题下展示用途、默认值和填写规则，输入行下提示“回车沿用当前值，也可直接修改”。参数说明可按窗口宽度换行，光标行列从实际渲染内容计算，不能保留固定行号。端口说明区分本机监听端口（0–65535，0 自动分配）与目标 Core 端口（1–65535）。输入值仍沿用原有默认/历史来源，不将普通回填值标成“上次使用”。

向导最后一步完成、退出菜单终端后，先打印 `执行命令: ...`，再交给对应程序。打印包含实际启动入口、所选模式、工作目录及该路径的参数；源码入口显示 Bun + 入口脚本，编译入口显示实际二进制路径。参数按 POSIX shell 单引号规则转义，可复制执行；不展开环境变量，不打印 Token。取消菜单不打印；失败后每次重试打印当前参数对应的命令。执行仍复用进程内启动入口，不将显示字符串交给 shell。

非交互终端拒绝启动，`menu --help` 例外。`menu` 可带 `--sandbox`；拒绝其他动作/启动参数。显式 sandbox 优先于历史 sandbox；attach 使用本次 sandbox，不额外增加目录问题，默认新建会话。

## 记忆

固定文件 `~/.config/atom/menu_history.json`，按动作保存上次成功的普通参数；自动回填后仍须 Enter 确认。目录延迟创建，取消不写盘。成功 attach 握手、配置保存、Gateway 请求成功、备份命令完成或服务就绪后保存，不等长期 App 退出。配置取消不算保存成功。

```json
{
  "version": 1,
  "commands": {
    "attach": { "coreServer": "192.168.1.20", "corePort": 3100 },
    "config": { "sandbox": "/path/to/project" }
  }
}
```

按字段白名单解析，不保存 API Key、管理 Token、日志。缺失使用默认值；损坏提示后使用默认值。临时文件 + rename 原子替换，权限 0600；保存失败告警，不阻断已经成功的启动。测试使用临时文件，不读写真实用户历史。

## 远程连接

复用 `--mode tui --core-server ... --core-port ...` 入口。Core 端显式设置 `ATOM_ADMIN_TOKEN` 并绑定可访问的 `--host` 后，允许携带该 Token 的远程管理请求。客户端在环境变量或 sandbox `.env` 设置相同 Token，不通过 CLI 或历史传递，也不转发给 Gateway 平台 Client 和 shell 工具子进程（共享的 `createChildProcessEnv` 负责移除此字段）。未设置时继续随机 Token + 仅本机管理访问；Gateway 管理访问保持仅限本机。本机 attach 优先使用 sandbox runtime 凭据。跨网络使用可信网络或加密隧道。

独立 TUI 的输入历史保存在客户端选择的 sandbox，由 `historySandbox` 显式传入；远端返回的 `serverInfo.sandbox` 仅用于显示，不作为客户端写盘位置。它与全局 menu_history.json 分工独立。

## 配置备份

`backup >` 提供 `export` 与 `import` 两条向导路径，复用 `atom export` / `atom import` 的实现，不启动 Core。

| 路径 | 步骤 | 说明 |
|------|------|------|
| `backup / export` | sandbox → output → encrypt | `output` 留空时写入当前目录的默认文件名 |
| `backup / import` | archive → sandbox | 归档路径必填；导入确认与密码提示在执行阶段完成 |

- 导出默认选择 `encrypt = yes`；选择 `no` 生成明文归档。密码只在执行时通过 TTY 隐藏输入或 `ATOM_BACKUP_PASSWORD` 提供。
- 导入不询问是否加密；`runBackupCommand` 先读取归档信封，只有 `encryption != null` 时才提示密码，未加密归档直接导入。
- 导入沿用直接命令的 `.env merge` 语义，现有文件自动备份；菜单不暴露 `--env replace` / `--dry-run` / `--force`。
- 历史只保存 `archive`、`output`、`encrypt`，不保存密码。执行成功后结束菜单并退出；失败按现有规则重新打开当前路径最后一步。
- 执行前打印可复制命令时，加密导出包含 `--password`，导入只包含归档与 sandbox，不输出密码值。

详见 [backup.md](./backup.md)。

## 实现与验收

- `src/bootstrap/menu-flow.ts`：导航、草稿、默认值、校验、启动参数和可复制命令格式化。
- `src/bootstrap/menu-history.ts`：白名单读取、按动作合并、原子保存。
- `src/bootstrap/menu.ts`：普通终端输入输出及恢复。
- `src/main.ts`：复用启动分流、成功保存历史、失败回到当前链路。

验证 CLI 兼容及冲突、每条路径、回退、历史损坏与隔离、远程鉴权默认拒绝及显式开放；PTY 验证取消、重试、终端恢复、向 App 交接。检查源码与编译后二进制。

### 2026-11-06 验证结果（v1.21.0）

- 常规 `bun test`：766 通过，0 失败；重型启动测试由下列命令单独运行。
- `ATOM_RUN_STARTUP_VALIDATION=1 bun test src/bootstrap/startup.integration.test.ts`：19 通过、0 失败，211 项断言。包括源码与二进制、菜单回退/取消、粘贴保护、403 后修改端口重试、真实消息的客户端历史隔离、二次启动回填、配置保存/取消，以及 Core 就绪后立即记忆。
- `bun run typecheck`、`bun run build`：全部 workspace 通过；新增 bootstrap 模块另行独立 `tsc --noEmit` 通过，`git diff --check` 通过。
- 本机二进制使用 `bun-darwin-arm64` 编译并验收。通用 `--target=bun` 打包仍受现有非本机 OpenTUI 原生包缺失影响，不新增依赖处理该问题。
- 根入口的额外整体类型扫描仍有原有 SDK 全局声明、MemoryService 可空值和旧启动测试类型问题，不计入本轮类型检查通过结论，未扩展修复范围。

所有历史测试使用临时 HOME，模型为本地假模型。远程权限策略用单元测试验证，attach 全链路通过本机回环端到端验证；尚未连接另一台物理机器验证网络。用户已有的 `sandbox/config.json` 保留，未用于测试。

命令打印补充验收：CLI/菜单定向测试 51 通过，菜单 PTY 测试 6 通过（78 项断言），workspace 与新增 bootstrap 类型检查通过。覆盖所有菜单路径的参数往返、特殊字符 shell 引用、源码/编译入口显示、重试打印新端口、取消无输出、凭据不输出；macOS 临时路径允许 `/var` 与 `/private/var` 的真实路径别名。

### v1.21.1 提交前回归

`bun test`：1392 通过、19 跳过、0 失败（构建后的 workspace 测试产物也被 Bun 发现）。19 项显式启动验收单独运行全部通过，224 项断言；workspace 类型检查/构建、新增 bootstrap 独立类型检查及差异检查通过。完整日志位于 `/private/tmp/atom-menu-v1.21.1-tests.log` 与 `/private/tmp/atom-menu-v1.21.1-startup.log`，临时日志可能被系统清理。

### 2026-11-07 导航优化验证

54 项 CLI/菜单定向测试、7 项菜单 PTY 验收（92 项断言）通过，新增 bootstrap 独立类型检查与差异检查通过。PTY 覆盖源码/编译入口的左右键导航、父菜单选中项恢复、End 跳转退出，以及原有取消、重试、命令打印、参数记忆和 App 交接。使用真实菜单屏幕构建函数检查窄列输入窗口与标题，并生成导航效果示意；未读写用户真实历史。

说明文案落地后，重新运行上述 54 项定向测试和 7 项菜单 PTY 验收，全部通过；独立类型检查与差异检查通过。检查 20/40/80 列的参数页，输入光标始终落在实际输入行（20 列为第 12 行，40/80 列为第 9 行），说明换行不覆盖输入；命令列表仍保持短名称，菜单说明最多两行，参数值与说明使用不同强调层级。

### v1.21.2 提交前回归

2026-11-07：常规 `bun test` 1398 通过、20 跳过、0 失败（包含构建后的 workspace 测试产物）；20 项显式启动验收全部通过，238 项断言。workspace 类型检查/构建、新增 bootstrap 独立类型检查、暂存差异检查通过。本次交付还包含聊天消息分隔线周围空行的修正。日志保存在 `/private/tmp/atom-menu-v1.21.2-tests.log` 和 `/private/tmp/atom-menu-v1.21.2-startup.log`，临时文件可能被清理。

### v1.21.3 合并 main 前回归

常规 `bun test` 1396 通过、20 跳过、0 失败（包含被发现的 workspace 构建产物）；20 项显式启动验收全部通过，238 项断言。workspace 类型检查/构建、新增 bootstrap 独立类型检查及差异检查通过。日志保存在 `/private/tmp/atom-menu-v1.21.3-tests.log` 和 `/private/tmp/atom-menu-v1.21.3-startup.log`；本次版本提交只修改版本来源和交付文档，本地配置与运行数据继续保留。

### 2026-11-10 配置备份菜单

`backup > export / import` 接入菜单。定向测试 89 通过（菜单流程、历史、归档编解码、CLI）；新增 PTY 验收 1 项、36 项断言，覆盖源码与编译二进制的未加密导出/导入，确认未加密归档不出现 `Password:` 提示。加密导出/导入另以源码 PTY 实测：仅在归档 `encryption != null` 时提示密码，历史记录不含密码。

完整 `bun test`：1430 通过、21 跳过、0 失败；workspace 类型检查与 `bun build --compile` 通过。
