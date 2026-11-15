# Gateway G6 本地验证矩阵（2026-11-15）

> 结论：**代码与文档完成；本地验证通过。真实 Telegram 平台验收、官方制品/生产索引发布待执行。**
> 主机：macOS，Bun 1.4.2。本记录不包含 Token、生产 URL 或真实账号数据。

## 验证矩阵

| 范围 | 命令 | 结果 |
|---|---|---|
| Gateway 源码 | `bun test src/packages/gateway/src` | 203 pass / 1 skip / 0 fail（19 files，805 assertions） |
| shared 配置/工具 | `bun test src/packages/shared/src/config src/packages/shared/src/utils` | 114 pass / 0 fail（15 files） |
| Bootstrap 定向 | `bun test src/bootstrap/cli.test.ts src/bootstrap/gateway-command.test.ts src/bootstrap/gateway-actions.test.ts src/bootstrap/gateway-upgrade.test.ts src/bootstrap/gateway-official.e2e.test.ts` | 65 pass / 0 fail（5 files，351 assertions） |
| Config TUI + Telegram + release | `bun test src/packages/config-tui/src clients/telegram-bot/src scripts/gateway-release.test.ts` | 137 pass / 0 fail（12 files，451 assertions） |
| 菜单回归 | `bun test src/bootstrap/menu-flow.test.ts src/bootstrap/menu-history.test.ts` | 53 pass / 0 fail（2 files，143 assertions） |
| PTY 全量 | `ATOM_RUN_STARTUP_VALIDATION=1 bun test src/bootstrap/startup.integration.test.ts` | 25 pass / 0 fail（308 assertions） |
| 工作区类型 | `bun run typecheck` | 通过（6 workspaces） |
| Node 类型 | `bun run typecheck:node` | 通过 |
| 文档链接/路径 | `bun run docs:check` | 通过 |
| 差异格式 | `git diff --check` | 通过 |
| Node bundle | `bun run build:node` | 通过（498 modules，`dist/node/main.js` 3.26 MB） |

## Gateway dist 旧产物

- gateway 包本地构建输出中存在旧忽略测试（`*.test.js`）。
- 该目录被 `.gitignore` 忽略，不属于源码验证来源；已删除，避免 `bun test src/packages/gateway` 误执行旧测试。
- 验证统一使用固定路径 `src/packages/gateway/src`。

## 未执行项

- 真实 Telegram 测试 Bot/账号消息往返：**PENDING**。
- 当前 host 真实发布归档、生产来源索引 URL、checksum 与下载：**PENDING**。
- 其他 target 的真实构建环境：**未声明/未生成**。
- 真实平台限流、重启、升级失败恢复的人工验收：**PENDING**，清单见 [telegram-platform-acceptance.md](./telegram-platform-acceptance.md)。

## 本地已覆盖

- manifest/registry/archive/install/resolver/ClientManager/admin/reload/diagnostic。
- source index schema/URL policy/stream limits/download checksum/timeouts/merge。
- official install/upgrade/rollback/uninstall reference protection/file cleanup。
- CLI/JSON/action/config-tui/PTY/menu。
