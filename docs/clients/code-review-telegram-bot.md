# 代码审查报告 — Telegram Bot Client 分支

> **审查范围**: `clients/telegram-bot/`、`src/packages/gateway/`、`src/main.ts`、`src/bootstrap/config.ts`
> **审查日期**: 2026-07-23
> **审查分支**: `feature/telegram-bot-client`

---

## P0 — 生产稳定性阻断器

### 1. `client-manager/index.ts:100-109` — `stop()` 从不杀死进程

```ts
private async stop(id: string): Promise<void> {
  const proc = this.#procs.get(id);
  if (proc) {
    proc.killed = true;  // ← 只标记，从未调用 proc.kill()
    this.#procs.delete(id);
  }
  this.#clients.delete(id);
  ...
}
```

第 81 行 `Bun.spawn` 返回的 `proc` 对象被丢弃，只存了 pid 到 `#procs` map。`stop()` 改变 `killed` flag 然后删 map 记录——**进程本身从未被终止**。`stopAll()` 后所有 client 子进程变成孤儿进程：继续运行、持有 secret、能访问 gateway。

**修复方向**：保存 `proc` 引用，`stop()` 调用 `proc.kill()`，等待 exit 后再删 map。

### 2. `client-manager/index.ts:84-85` — stdout/stderr pipe 无人消费

```ts
stdout: "pipe",
stderr: "pipe",
```

PIPE 模式下 Bun 为子进程分配 OS 管道缓冲区。没有代码调用 `proc.stdout.read()` / `proc.stderr.read()`。子进程输出达到 64KB（macOS 默认管道容量）后，write 系统调用阻塞，进程挂死。任何往 stdout 打日志的 client 最终都会死。

**修复方向**：改为 `"inherit"`（输出到 Gateway 的 stdout/stderr），或改为 `"ignore"`。

### 3. `client-manager/index.ts:86-91` — 无退避重启死循环

```ts
onExit: (_, exitCode, signalCode, error) => {
  ...
  if (this.#clients.has(id)) {
    this.#logger.info("restarting client", { id, platform });
    this.spawn(cc);  // ← 立即无延迟重启
  }
}
```

如果 binary 路径错误或启动即崩溃，每毫秒 spawn 一次，CPU/PID/端口瞬间耗尽。且 `onExit` 不检查 `#procs` 中的 `killed` 标志——`stop()` 和 `onExit` 竞态时已停止的 client 会被复活。

**修复方向**：指数退避（1s → 2s → 4s → ... → 30s cap）+ 最大重试次数 + `onExit` 检查 `killed` 标志。

### 4. `clients/telegram-bot/src/main.ts:275-281` — 轮询循环一次异常即永久死亡

```ts
async function startLongPolling(): Promise<void> {
  ...
  while (true) {
    await pollOnce();  // ← 无 try/catch
    if (backoffMs > 0) await sleep(backoffMs);
  }
}
```

`pollOnce` → `tgCall` → `handleUpdate` → `fetch(gateway)` 中任何一环抛网络异常（gateway 宕机、DNS 失败），异常穿过 `while(true)` 到达 `startLongPolling().catch(console.error)`。结果：
- ❌ 轮询线程死亡
- ✅ HTTP server 仍运行，`/health` 仍返回 200
- ❌ bot 永久停止接收新消息，外部看起来完全健康

**修复方向**：`while(true)` 内加 try/catch，失败时指数退避后继续。

### 5. `clients/telegram-bot/src/main.ts:269-271` — offset 在处理前提交，消息可靠丢失

```ts
updateOffset = update.update_id + 1;  // ← 先提交
await handleUpdate(update);           // ← 后处理（可能抛错）
```

Telegram 的 getUpdates 语义：offset 推进后即确认消息已处理，失败不会重投。叠加 P0#4 的异常穿透，gateway 抖动期间消息确定性地永久丢失。

**修复方向**：处理成功后再推进 offset；处理失败时不更新 offset。

### 6. `src/main.ts:164-174` — `--mode full` 无优雅停机

```ts
case "full": {
  const core = await startCore({ ... });
  const gateway = await startGateway({ ... });
  ...
  break;  // ← 然后 main 结束，进程退出
}
```

没有保存 `core.stop()` / `gateway.stop()`。没有注册 SIGINT/SIGTERM handler。用户 Ctrl+C → 主进程退出 → gateway 的 client 子进程全部变孤儿。对比 `--mode tui` 分支有完整的 `try/finally { core.stop(); sm.stopAll(); }`。

**修复方向**：`case "full"` 分支加 `try/finally`，保存引用并在 finally 中调用 stop。

---

## P1 — 核心逻辑缺陷

### 7. `gateway/server.ts:42` — `req.json()` 在 try 外，`msg.data.text` 无保护

```ts
async function handleInbound(client, req) {
  const msg = await req.json() as InboundMessage;  // ← 抛异常点 1
  logger.info(..., text: msg.data.text.slice(0, 50));  // ← 抛异常点 2
  try { ... } catch { ... }
}
```

非法 JSON → 500 无日志。`msg.data` 缺失 → TypeError 无日志。L106 `/gateway/event` 的 `req.json()` 同理。

**修复方向**：`req.json()` 和 `msg.data.text` 移到 try 块内；或用 schema 解析库校验。

### 8. `gateway/server.ts:59-63` — task-result 推送无超时、无失败检查

```ts
await fetch(`${client.url}/task-result`, {
  method: "POST",
  headers: { ... },              // ← 无 AbortSignal.timeout
  body: JSON.stringify(...),
});
// ← 响应状态未检查
```

client 进程僵死 → fetch 永久阻塞 → handleInbound 的连接被占用 → task 结果丢失 → 用户收不到回复。

**修复方向**：加 `AbortSignal.timeout(10000)`；检查 `res.ok`，失败时重试或记错误。

### 9. `gateway/server.ts:136` — `stop()` 的 Promise 被丢弃

```ts
return { stop: () => { server.stop(); cm.stopAll(); } };
```

`cm.stopAll()` 是 async 函数，返回 Promise。`stop` 类型声明为 `() => void`，Promise 被静默丢弃。调用方无法 await 完整清理。即便 P0#1 修好后 `stopAll` 能工作，类型也在骗人。

**修复方向**：改为 `stop: async () => { server.stop(); await cm.stopAll(); }`，类型标注为 `() => Promise<void>`。

### 10. `clients/telegram-bot/src/main.ts:164-177` — 400 降级发送的是转义后文本

```ts
const fallback: Record<string, unknown> = { chat_id: chatId, text: chunks[i] };
```

`chunks[i]` 是 `telegramify()` 输出——所有特殊字符已被转义（`\* \_ \#`）。降级时用户看到满屏 `\! \* \#` 字面量，而非原本内容。

**修复方向**：降级时用原始（未经 telegramify 转义的）text 重新分片发送。

### 11. `splitMessage` 与 `telegramify` 的互操作问题

`telegramify` 把 `*` → `\*`。`splitMessage` 按 4096 字符切分时，可能恰好在 `\` 和 `*` 之间切开。chunk 以孤立 `\` 结尾 → Telegram MarkdownV2 解析失败 → 触发 P1#10 的降级 → 降级文本又是转义后的。两个问题连环放大。

**修复方向**：先 `splitMessage(originalText)` → 对每个 chunk 单独 `telegramify()`。

---

## P2 — 安全问题 & 配置缺陷

### 12. `client-manager/index.ts:74-76` — secret 在进程启动前注册

```ts
this.#clients.set(id, client);
this.#secretMap.set(secret, client);  // ← 先注册
const proc = Bun.spawn(...);          // ← spawn 可能抛错
```

binary 路径错误 → spawn 抛异常 → secret 留在 map → 通过 `/gateway/inbound` 用此 secret 能认证成功 → 请求被转发到无人监听的端口。

**修复方向**：spawn 成功后再注册 secret；spawn 失败时清理已注册的 client。

### 13. `gateway/server.ts:91-111` — `/gateway/*` 路由没有限流

JWT 路由有 `limiter.allow()`，但 secret 认证的 `/gateway/*` 路由没有。失控/恶意 client 可以无限制提交任务压垮 Core。

**修复方向**：为 `/gateway/inbound` 添加 per-client 限流。

### 14. `gateway/config.ts:14` — host 默认 `0.0.0.0`

Gateway 定位为本机 client 中转层。监听 `0.0.0.0` 把端口暴露到局域网，与"secret 仅本机进程"的安全模型矛盾。

**修复方向**：默认值改为 `"127.0.0.1"`。

### 15. `gateway/config.ts:16` — jwtSecret 硬编码默认值

```ts
jwtSecret: z.string().min(16).default("change-me-minimum-16-chars")
```

任何人知道这个字符串就能伪造 JWT token。虽然文档已决定删除 JWT，代码尚未清理。

**修复方向**：删除 `jwtSecret`、`rateLimitEnabled`、`rateLimitRequestsPerMin`、`rateLimitBurst` 这 4 个已废弃字段。

### 16. `clients/telegram-bot/src/main.ts:299` — webhook secret 明文记日志

```ts
console.log(`[tg] webhook registered: ${webhookUrl}`);
// webhookUrl = https://example.com/tg/{webhookSecret}
```

任何能查看日志文件的人都能伪造 Telegram 回调。

**修复方向**：日志只输出 host+path 前缀，不包含 secret 令牌部分。

### 17. `clients/telegram-bot/src/main.ts:232-242` — `is_bot` 检查在自动回复之后

群聊里任何消息先触发 `"请私聊使用。"` 或 `"目前仅支持文本消息。"` 回复，然后才检查 `is_bot`。两个 bot 互发消息 → 互相回复 → 无限循环。

**修复方向**：`is_bot` 检查移到所有自动回复之前。

---

## P3 — 健壮性 & 边界条件

### 18. `clients/telegram-bot/src/main.ts:275-276` — 重启后重复处理历史消息

```ts
await tgCall("deleteWebhook", {});
```

`deleteWebhook` 没有加 `drop_pending_updates: true`。重启后 `updateOffset=0`，getUpdates 返回过去 24h 内所有未确认消息，全部重新处理。

**修复方向**：加 `{ drop_pending_updates: true }`，或持久化 `updateOffset`。

### 19. `clients/telegram-bot/src/main.ts:109` — `tgCall` 的 `backoffMs` 是模块级共享状态

所有 API 调用（getUpdates、sendMessage、setWebhook 等）共用同一个 `backoffMs` 变量。sendMessage 的网络错误会影响 getUpdates 的退避节奏。

**修复方向**：per-call 或 per-endpoint 的 backoff 状态。

### 20. `clients/telegram-bot/src/main.ts:66,71` — `parseInt` 无 NaN 检查

```ts
port: parseInt(portStr),
webhookPort: parseInt(getArg("webhook-port") ?? "8443"),
```

`--port abc` → `port = NaN` → `Bun.serve({ port: NaN })` → 行为未定义。

**修复方向**：`isNaN` 检查，非法值时打印错误并退出。

### 21. `clients/telegram-bot/src/main.ts:337-340` — stop 命令在响应前退出

```ts
if (cmd.action === "stop") {
  server.stop();
  process.exit(0);  // ← 没等到 return Response.json(...) 就退出
}
return Response.json({ ok: true });  // ← 永不执行
```

Gateway 收到连接重置，无法区分正常停止与崩溃。

**修复方向**：先响应 `{ ok: true }`，再 `process.exit(0)`。

### 22. `clients/telegram-bot/src/main.ts:223` — `lastMessageIds` Map 无界增长

从不清理。长运行时间 + 群聊场景内存泄漏。

**修复方向**：添加 LRU 清理或定期清理。

### 23. html_del 函数 — 标题正则跨 segment 运行会破坏 fenced code block

```ts
// 标题正则：在 joined 结果上运行，"捕获跨 segment 边界的标题"
return result
  .replace(/(?<=[^\n#\\])(#{1,6}...)$/gm, ...);
```

代码注释说"捕获跨 segment 边界"，但 segment 边界（`` ``` `` 后面紧跟 `# 标题`）本来就是正确的格式。这个"补丁"的实际风险：fenced code block 内的 `代码注释 # 配置` 被插入换行，毁坏代码块内容。

**修复方向**：移除"在 joined 结果上运行"的标题正则，或将其也纳入 segment 内处理。

---

## P4 — 低优先级 & 代码卫生

### 24. `gateway/config.ts:28` — `parseInt` 无 radix 参数

```ts
if (Bun.env.GATEWAY_PORT) env.port = parseInt(Bun.env.GATEWAY_PORT);
```

`GATEWAY_PORT=3000abc` → `3000`（静默接受）。`GATEWAY_PORT=abc` → `NaN`（zod 拒绝但错误信息不友好）。

**修复方向**：`Number(GATEWAY_PORT)` + 范围检查。

### 25. `clients/telegram-bot/src/main.ts:200` — 列表正则可能误伤数学/箭头表达式

`a * b`、`2 + 3`、`a -> b`、`section 3. Description` 在句中可能触发换行。fix + telegramify + split + send 链路中，中间变形可能引起意外 MarkdownV2 解析行为。

**修复方向**：评估实际 LLM 输出中这些模式出现的频率，决定是否加更多限制条件。

### 26. `bootstrap/config.ts` vs `gateway/config.ts` — clients 类型两处定义

bootstrap 中 `id: z.string()`（无 `.min(1)`），gateway 中 `id: z.string().min(1)`（有）。空白 id 可以通过 bootstrap 验证，到 gateway 二次解析时才报错。

**修复方向**：gateway 的 `ClientConfigSchema` 作为单一数据源被 bootstrap 引用。

### 27. Gateway 独立 logger 与主 logger 脱节

`gateway/server.ts` 自建 `LogHub + StdoutSink("info")`，无视 `args.logLevel`/`logIgnore`/`logModes`。`--mode full --log=file` 时 gateway 日志仍打到 stdout。

**修复方向**：从 `startGateway` 参数接收主 logger 实例，或接受日志配置。

### 28. dead code：secret.ts 的 `verifySecret` / `withSecretHeader` 从未被使用

server.ts 直接 `cm.getBySecret(secret)`（Map 查找），手写的 `verifySecret` 函数（含 timing-safe 比较）是死代码。造成安全的"虚假保障"。

**修复方向**：要么在 `getBySecret` 路径上实际使用 `verifySecret`，要么删除。

### 29. dead code：`permissions/checker.ts` 整个模块无调用方

jwt 文件不存在于 barrel export 但 `checker.ts` 文件仍存在且包含测试。

**修复方向**：删除文件及其测试。

### 30. `tgCall` 中 429 退避不设置 `backoffMs`

```ts
if (data.error_code === 429) {
  const wait = (data.parameters?.retry_after ?? Math.min(2 ** attempt, 30)) * 1000;
  await sleep(wait);
  continue;  // ← backoffMs 未更新
}
```

429 只 sleep，不更新 `backoffMs`。持续限流时 `getUpdates` 收不到消息就立即重新轮询——对 Telegram 服务和本地 CPU 都是不必要的压力。

---

## 修复优先级顺序

| 批次 | 编号 | 说明 | 估计工作量 |
|------|------|------|-----------|
| P0 | #1, #2, #3 | client-manager 进程管理三件套 | 1.5h |
| P0 | #4, #5 | telegram-bot 轮询健壮性 | 0.5h |
| P0 | #6 | main.ts full 模式停机 | 0.5h |
| P1 | #7, #8 | gateway server 健壮性 | 1h |
| P1 | #9, #10, #11 | sendReply 降级 + 分片顺序 | 1h |
| P2 | #12–#17 | 安全 & 配置 | 1h |
| P3 | #18–#23 | 健壮性 & 边界 | 1h |
| P4 | #24–#30 | 代码卫生 | 0.5h |

> **总计**: ~7h 工作量，建议分 2–3 次迭代完成。P0+P1（共 ~4.5h）应在 merge 前修完。P2–P4 可在后续迭代中处理。
