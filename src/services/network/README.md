# Network Service

同进程 `NetworkService` 统一承载网络能力，并通过 `ServiceManager` 管理生命周期。

| 文件 | 职责 |
|---|---|
| `network-service.ts` | Service 入口、生命周期、共享调度与结构化日志 |
| `domain-scheduler.ts` | 普通/搜索域名时间槽和 HTTP 429 冷却 |
| `web-fetch.ts` | WebFetch 的 URL、浏览器 UA、HTTP、取消和正文提取实现 |
| `network-service.test.ts` | Service 并发、冷却、取消和结果测试 |

本阶段只实现 `webFetch()`。未来 download、stream 或 Worker 必须独立设计；若新增真实网络
请求，应复用同一个 `DomainScheduler`，不能自行绕过域名策略。
