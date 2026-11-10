# 历史记录（Records）

> 本目录存放**历史验收、实验与开发计划记录**，用于追溯当时的结论、证据与已知限制。
> 这些文档**不是当前设计文档**，其中的状态、文件路径与实现描述可能已经过时；当前行为请以
> [文档索引](../index.md) 中的设计文档和源码为准。

## 记录索引

| 记录 | 内容 |
|------|------|
| [startup-validation.md](./startup-validation.md) | 启动模式的早期验收记录（常规测试与隔离进程测试） |
| [startup-modes-plan.md](./startup-modes-plan.md) | 启动模式、TUI attach 与 Client 控制的分阶段计划 |
| [context-snapshot-cache-plan.md](./context-snapshot-cache-plan.md) | Context 静态/动态文本缓存方案与 Token 小样本实验 |
| [continuation-validation.md](./continuation-validation.md) | 统一续写仲裁的首次验收、真实会话证据与已知限制 |
| [progress-evidence-experiment.md](./progress-evidence-experiment.md) | Post/续写跟踪参数完整方案、消融对照与最终选择 |
| [code-review-telegram-bot.md](./code-review-telegram-bot.md) | Telegram Bot Client 的代码审查报告（历史快照） |

## 使用约定

- 新增设计文档放在对应主题目录，不要放在本目录。
- 新的验收/实验记录可以放在本目录，并在标题或开头注明日期与适用范围。
- 引用本目录文档时优先使用相对链接；链接失效只影响追溯，不回写历史结论。
