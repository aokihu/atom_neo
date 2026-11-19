# Telegram 真实平台验收清单（G6）

> 状态：**待执行（PENDING）**。本清单不包含真实 Token，也没有在本轮连接 Telegram。
> 目的：在独立测试账号/测试 Bot 上验证 Gateway + Telegram Client 的真实平台链路。不得使用生产账号或真实用户数据。

## 1. 环境与凭据

- [ ] 独立 macOS/Linux 主机与临时 sandbox（不要使用个人 sandbox）。
- [ ] BotFather 创建的**测试 Bot**；Token 只写入临时 sandbox `.env` 或验收环境变量，不写入命令、日志、文档或聊天记录。
- [ ] 一个测试 Telegram 用户/群组；记录测试范围，不邀请真实用户。
- [ ] 记录：Atom 版本、OS/arch、Bun/Node 版本、Gateway/Client 版本、target。
- [ ] 本地/测试来源索引地址与归档 sha256；禁止使用未经验证的生产 URL。

建议环境变量：

```bash
export ATOM_SANDBOX=/tmp/atom-telegram-acceptance
export ATOM_GATEWAY_SOURCE_INDEX=/tmp/atom-gateway-source-index.json
# ATOM_ADMIN_TOKEN 使用本次验收随机值，不写入仓库
```

## 2. 制品与安装

- [ ] 在目标 host 构建 Telegram Client：`bun run --cwd clients/telegram-bot build`。
- [ ] 生成当前 host 归档与索引：`bun run gateway:release -- --client clients/telegram-bot --base-url <验收基础 URL> --out /tmp/atom-release`。
- [ ] 记录归档路径、target、sha256、size；确认索引只包含实际构建 target。
- [ ] 执行本地安装/官方来源安装（二者至少各一次）：
  - `atom gateway install <archive> --sandbox "$ATOM_SANDBOX"`
  - `atom gateway install telegram-bot@<version> --source "$ATOM_GATEWAY_SOURCE_INDEX" --sandbox "$ATOM_SANDBOX"`
- [ ] 同版本重复安装幂等；同版本不同内容被拒绝。

## 3. 配置与启动

- [ ] `atom config --sandbox "$ATOM_SANDBOX"` 或 MenuApp Configure/Advanced 创建/编辑实例；secret 输入过程不显示原文。
- [ ] 确认 `.env` 只保存 credential 值，`config.json` 只保存引用；日志/菜单历史不出现 Token。
- [ ] `atom gateway list --sandbox "$ATOM_SANDBOX"` 区分 configured/registered/running。
- [ ] 启动 Gateway：`atom --mode core-gateway --sandbox "$ATOM_SANDBOX"`。
- [ ] 启动实例（UI 或 `atom gateway start <instance>`），确认 supervisor running。

## 4. 真实消息往返

- [ ] `/health` 为 200，但**单独**记录：health 成功不等于平台凭据有效。
- [ ] `atom gateway check <instance>`：
  - [ ] Client `/diagnostics` 返回 `ok`，`getMe`/bot 名称可读；
  - [ ] 不得调用 `/health` 冒充平台检查。
- [ ] 测试用户向 Bot 发送一条消息。
- [ ] Core 收到 task，Telegram 收到回复；记录 task 状态、回复文本摘要（不含 Token）。
- [ ] 重启 Client 后再发一条消息，确认会话按预期延续/新建。
- [ ] 记录消息往返时间、失败重试次数、offset 行为。

## 5. Busy / 限流 / 重载

- [ ] 在消息处理中触发 `atom gateway reload <instance>`：
  - 目标实例暂拒新 inbound，返回 503 `{error:"Client busy"}` + `Retry-After: 1`；
  - 其他实例不受影响；
  - 在途消息完成或超时后按契约处理。
- [ ] Telegram 收到 503/429 时不会静默丢消息；busy 不推进 update offset。
- [ ] 非 busy 错误同一 update 最多 3 次，之后按设计推进 offset 并记录“跳过”。
- [ ] 重载成功：旧进程停止、Secret 撤销、新进程 ready；旧 timer/exit 不复活。

## 6. 升级失败恢复

- [ ] 安装/准备一个 v2 制品，但让 v2 启动失败（错误 entry、缺失依赖或测试替身）。
- [ ] `atom gateway upgrade <instance> --version <v2>`：
  - [ ] 返回失败并明确说明 config 已回滚；
  - [ ] 旧版本 supervisor 恢复并 running；
  - [ ] 同实例新 inbound 仍可由旧版本处理；
  - [ ] 新版本制品仍保留在 registry，便于修复后重试。
- [ ] 如果旧版本也无法恢复，记录双失败与人工恢复步骤。

## 7. 卸载与清理

- [ ] 被实例引用的包无法卸载。
- [ ] 解除引用后卸载：registry 与包目录删除，`.env`/源码/会话不删除。
- [ ] 停止 Gateway，确认 `core-runtime.json` / `gateway-runtime.json` 清理。
- [ ] 删除临时 sandbox 与测试 Bot Token（BotFather revoke 或删除测试 Bot）。

## 8. 多账号边界

- [ ] 同平台第二个账号不宣称隔离；仅验证既有拒绝规则：
  - 同一会话被不同 Client 发起者写入时被拒绝；
  - 不把“能同时配置两个实例”写成“完整多账号已支持”。

## 9. 证据与结论

记录以下内容（**不得包含 Token、聊天隐私原文或生产数据**）：

- 日期、主机、OS/arch、Atom/Bun/Node 版本；
- 制品 target、sha256、size、索引 URL；
- 执行的命令与退出码；
- Gateway/Client PID、runtime 文件状态；
- task id、消息往返结果、重试/offset 摘要；
- 升级失败与恢复结果；
- 未执行项和原因。

验收结论只能是以下之一：

- **PASS（真实环境）**：所有真实平台步骤通过；
- **PARTIAL**：本地/单元验收通过，真实平台步骤仍 pending；
- **FAIL**：真实平台步骤失败，附失败证据与回滚结果。

当前状态：**PARTIAL — 本地 fixture/PTY 已通过，真实 Telegram 平台步骤 PENDING。**
