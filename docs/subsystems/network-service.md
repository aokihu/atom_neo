# Network Service — 设计与执行边界

> **用途**：统一管理 Atom Neo 进程内的网络能力。`webFetch()` 是首个子功能；
> `download`、`stream` 与 Worker 仅作为未来扩展方向，本阶段不提供占位实现。

---

## 1. 架构定位

```text
AI SDK Tool Call
  → Core webfetch Tool Adapter
  → NetworkServiceLike.webFetch()
  → NetworkService
      ├── DomainScheduler       # 跨 Task/Session 的域名节流与 429 冷却
      └── WebFetch              # HTTP、取消、正文读取与 HTML 提取
  → WebFetchResponse
  → ToolResult
```

`NetworkService` 是由应用层 `ServiceManager` 管理的同进程 Service。Core 只依赖
`NetworkServiceLike`，不依赖实现类，也不持有域名队列或 HTTP 状态。

## 2. 职责边界

| 层 | 负责 | 不负责 |
|---|---|---|
| Core Tool Adapter | Tool 名称、Schema、权限、ToolResult 映射 | HTTP、节流、正文处理 |
| ToolGuard / Governance | 前置条件、判重、调用预算、无进展停止 | 网络并发与 429 冷却 |
| NetworkService | 生命周期、共享域名调度、结构化日志、子功能入口 | AI SDK 类型、Prompt、Agent 决策 |
| WebFetch | URL 校验、HTTP 请求、Timeout/Abort、HTML 提取 | 搜索、下载、流式传输 |

## 3. 公共契约

```typescript
interface NetworkServiceLike {
  webFetch(
    request: WebFetchRequest,
    options?: NetworkRequestOptions,
  ): Promise<WebFetchResponse>;
}
```

跨层契约位于 `@atom-neo/shared`，不引用 AI SDK 的 `ToolResult`。Service 返回稳定的
领域状态，Tool Adapter 再转换为模型可见结果。

## 4. WebFetch 调度规则

- 普通域名请求起始时间至少间隔 1 秒。
- 搜索引擎同一主域至少间隔 5 秒，子域共享节流键。
- 并发请求先预留下一个时间槽，再等待执行。
- HTTP 429 优先采用更长的 `Retry-After`，否则默认冷却 60 秒。
- 冷却期间不发出真实请求。
- 排队和 HTTP 请求均服从调用方 `AbortSignal`。
- 不同域名使用独立时间槽，仍可承接 AI SDK 的并行 Tool Calls。
- 每次真实请求从内置浏览器 User-Agent 池随机选择；默认使用桌面 Chrome/Safari，
  `isMobile: true` 时使用移动 Chrome/Safari。具体 UA 字符串不暴露给 Tool。

调度状态由唯一 `NetworkService` 实例持有。未来 `download` 或 `stream` 若实现，必须复用
同一调度器，不能维护独立域名预算。

## 5. 生命周期与依赖注入

```text
main.ts
  → new NetworkService()
  → ServiceManager.register("network", service)
  → await ServiceManager.startAll()
  → startCore({ sm })
  → Core 获取 NetworkServiceLike
  → createWebFetchTool(network)
```

生产启动缺少 NetworkService 时应立即失败，不能把不可执行的 WebFetch 暴露给模型。
测试通过注入 `fetch`、时钟和等待函数控制网络与时间，不使用全局单例。

## 6. 日志

NetworkService 记录 `feature`、`domain`、`queueWaitMs`、`networkMs`、HTTP 状态、响应字节数、
冷却时间和稳定结果码。日志不得记录请求正文、敏感 Header、页面正文或完整查询参数。

## 7. 浏览器请求身份

WebFetch Tool 只新增可选的 `isMobile` 布尔值，不提供浏览器名称、版本或 User-Agent 专用参数。
NetworkService 在对应的桌面或移动池中随机选择一个 UA。原有通用 `headers` 中显式传入的
`User-Agent` 仍优先，用于保持兼容。

UA 模拟只影响服务端的基础内容协商，不能模拟 JavaScript、Cookie、TLS 指纹、Client Hints
或真实浏览器会话；遇到登录墙、验证码或依赖脚本渲染的页面仍应判定为不可用内容。

## 8. 本阶段非目标

- Worker / Worker Pool
- `download()` / `stream()`
- WebSearch
- 缓存、Proxy、Cookie 与自动重试
- Readability、CAPTCHA、登录墙和重复内容分类
- 新的 SSRF 或内网访问策略

这些能力需要独立设计和验收；本次迁移只改变职责位置，不扩大现有网络行为。
