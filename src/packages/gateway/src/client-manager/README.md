# client-manager

Gateway 平台 Client 子进程管理。`ClientManager` 只做 facade，每个 Client 由一个 `ProcessSupervisor` 负责进程生命周期。

`ProcessSupervisor` 只消费 `ResolvedClientConfig`（`command` / `cwd` / `env` / `platform` / `stdio` / `clientArgs`），不再理解 manifest 或实例配置。resolver 由 bootstrap 在启动前完成，`ClientManager` 接收已解析的 Client 数组，并支持运行期动态登记、移除和替换。

| 文件 | 职责 |
|---|---|
| `index.ts` | `ClientManager` facade：动态 `register/remove/reload`、`startAll/stopAll/start/stop`、`list/status/getBySecret/getById`；端口集合与心跳 |
| `client-command.ts` | `buildClientArgs` 参数映射、`buildClientCommand` 命令拼装、`buildSpawnOptions`（env/cwd/stdio）与 readiness 轮询 |
| `process-supervisor.ts` | 单 Client 的 spawn/readiness/stop/health/restart 与进程状态机；只读 `port/state/desired/active/isRunning` |
| `process-state.ts` | 纯状态机 `idle → starting → running → stopping → idle`、`failed → starting` |
| `restart-policy.ts` | 重启上限 5 次、`1s * 2^n` 退避、30s 上限、成功后 reset |
| `health-probe.ts` | `/health` 探测；非 2xx、超时、网络错误统一返回 unhealthy |
| `runtime.ts` | 生产默认 `spawnProcess` / `fetch` / `now` / timer / sleep |
| `test-helpers.ts` | 测试用 fake runtime、fake process、fake clock；不启动真实子进程 |

## 动态实例

- 构造函数的初始 `clients` 只登记为空闲实例，不启动进程；重复 id 继续拒绝。
- `register(config)` 同步登记空闲实例，重复 id 抛错。端口从 `clientPortRangeStart` 起取当前活动端口集合中的最小空闲值。
- `remove(id)` 先停止再删除 supervisor/config，并释放端口；之后 `register` 可复用最小空闲端口。
- `reload(id, config)` 保留实例 id、端口和 `desired`：先停止旧 supervisor，再用新配置创建**新的** supervisor 并替换映射；旧实例原本在运行则启动新实例。新实例启动失败时保持 `failed` 并向上抛错，其他实例不受影响。
- `startAll` / `stopAll` 遍历实际 supervisor 映射，而不是构造时的初始数组。`stopAll` 设置 stopping、清除心跳，等待所有 per-id 队列收敛后再快照并停止 supervisor，返回时无残留重启 timer。

## 并发与端口

`start` / `stop` / `remove` / `reload` 共用 per-id promise 队列：同一实例的操作按调用顺序串行，不同实例互不阻塞。队列中的操作在执行时才查找当前 supervisor，因此 reload 之后的 start/stop 会作用于新实例。

端口由 `#ports: Set<number>` 跟踪活动分配，`#portStart` 记录范围起点。reload 不释放端口；remove 释放端口，下一次登记重新选择最小空闲值。`#stopping` 后 `start` / `register` / `reload` 报 `Gateway is stopping`。

## 重载边界

reload 在旧 supervisor 完成 `stop()` 后才创建替代者，并立即替换 `#configs` 与 `#supervisors`。旧 supervisor 的 exit 回调、generation 和 restart timer 都绑定在旧对象上；`stop()` 已清除其 timer 并排空队列，因此旧进程迟到的 exit 或已排队重启不会 spawn 或替换新进程。新 supervisor 使用同一端口和实时 gateway 端口 getter。

## 状态投影

`list()` 保持兼容的 `{id, running, desired}`。`status()` 返回 `{id, platform, source, running, desired, state, port, active}`；`active` 只投影 `{id, platform, port, url}`，不暴露平台 secret。需要完整 `ActiveClient`（含 secret）的内部调用继续使用 `getById`。

## Gateway 端口

`ClientManager` 不缓存启动时的 gateway 端口，而是向 supervisor 传入实时 getter `() => config.port`。`ProcessSupervisor` 在每次 spawn（含重启与 reload）时解析该 getter，因此 `startGateway({ port: 0 })` 在 `httpServer.serve()` 回写实际端口后启动的 Client 会拿到正确地址，不会出现 `--gateway-url http://127.0.0.1:0`。`gatewayPort` 仍接受普通 `number`，供直接构造 supervisor 的测试使用。

## 生命周期

```text
start → spawn → 注册 secret/port → readiness poll (100ms, 10s)
      → running → 每 30s health probe
exit / health_failed → failed → RestartPolicy timer → starting
stop → 清 timer + desired → stopping → SIGTERM → (timeout) SIGKILL → idle
reload → stop 旧 supervisor → 新 supervisor（同端口）→ 原 desired 为 true 时 start
```

约束：

- 手动 stop、`stopAll`、give_up 都不得再 spawn。
- 异常退出与健康失败共用同一个重启入口；健康成功运行 ≥60s 后重置计数。
- `stopAll` 需要在返回后无残留 timer；测试用 `FakeClock.pendingTimers` 断言。
- 旧 supervisor 的回调或 timer 不得影响 reload 后的新进程。
- 公开 API、Gateway 路由/鉴权/状态码、端口与 secret 规则保持不变。
