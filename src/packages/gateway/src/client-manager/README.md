# client-manager

Gateway 平台 Client 子进程管理。`ClientManager` 只做 facade，每个 Client 由一个 `ProcessSupervisor` 负责进程生命周期。

| 文件 | 职责 |
|---|---|
| `index.ts` | `ClientManager` facade：`startAll/stopAll/start/stop/list/getBySecret/getById`；端口分配与心跳 |
| `process-supervisor.ts` | 单 Client 的 spawn/readiness/stop/health/restart 与进程状态机 |
| `process-state.ts` | 纯状态机 `idle → starting → running → stopping → idle`、`failed → starting` |
| `restart-policy.ts` | 重启上限 5 次、`1s * 2^n` 退避、30s 上限、成功后 reset |
| `health-probe.ts` | `/health` 探测；非 2xx、超时、网络错误统一返回 unhealthy |
| `runtime.ts` | 生产默认 `spawnProcess` / `fetch` / `now` / timer / sleep |
| `test-helpers.ts` | 测试用 fake runtime、fake process、fake clock；不启动真实子进程 |

## 生命周期

```text
start → spawn → 注册 secret/port → readiness poll (100ms, 10s)
      → running → 每 30s health probe
exit / health_failed → failed → RestartPolicy timer → starting
stop → 清 timer + desired → stopping → SIGTERM → (timeout) SIGKILL → idle
```

约束：

- 手动 stop、`stopAll`、give_up 都不得再 spawn。
- 异常退出与健康失败共用同一个重启入口；健康成功运行 ≥60s 后重置计数。
- `stopAll` 需要在返回后无残留 timer；测试用 `FakeClock.pendingTimers` 断言。
- 公开 API、Gateway 路由/鉴权/状态码、端口与 secret 规则保持不变。
