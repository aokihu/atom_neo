# P6: Memory Service — 实施方案 ✅ 已完成

## 目标

完整的长期记忆系统：全文搜索（ripgrep）+ 图谱遍历（SQLite）+ 后台权重衰减。

## 架构

```
.atom/memory/
├── memory.db              # SQLite (bun:sqlite) — 节点元数据 + 图谱边
│   ├── nodes:  id, tags, weight, content_preview, created_at, accessed_at
│   └── edges:  id, source_id, target_id, relation
└── nodes/
    ├── abc123.txt          # 纯文本内容（ripgrep 搜索目标）
    └── def456.txt
```

## 组件

### MemoryService（extends BaseService）

| 方法 | 说明 |
|------|------|
| `search(query, limit?)` | ripgrep 扫 `.txt` → SQLite 查元数据 → 排序返回 ≤3 |
| `traverse(startId, maxSteps?)` | SQLite edges 表 BFS → 获取关联记忆 |
| `save(content, tags?)` | SHA256 计算 hash → 写入 `.txt` + INSERT SQLite |
| `link(source, target, relation)` | INSERT edges 表 |
| `start()` | 初始化 DB + 启动 `setInterval` 后台任务 |
| `stop()` | 停止 `setInterval` |

### 后台任务（每 5 分钟）

1. **衰减** — `UPDATE nodes SET weight = MAX(0, weight - daysSince * 1)`
2. **清理** — `DELETE FROM nodes WHERE weight <= 0`
3. **同步文件** — 删除 DB 中已清理的 `.txt` 文件

### 搜索评分

```
score = weight/100 × 0.7 + tagMatchCount × 0.3
```

### 遍历评分

```
score = source.weight × 0.5 + target.weight × 0.3 + matchScore × 0.2
```

## 改动文件

| 文件 | 操作 |
|------|------|
| `src/services/memory-service.ts` | **新建** |
| `src/bootstrap/agents.ts` | 增加 `memory/nodes/` 创建 |
| `src/main.ts` | 注册 MemoryService 到 ServiceManager |
| `src/packages/core/src/tools/builtin/memory.ts` | stub → 调用 MemoryService |
| `src/packages/core/src/server.ts` | CoreDeps 传递 MemoryService |
| `src/packages/core/src/pipelines/conversation/elements/index.ts` | collect-context 注入记忆 |

## 测试用例

1. **保存 + 搜索** — 保存记忆 → 搜索命中
2. **多轮记忆** — 两轮对话各 save 一条 → search 返回多条
3. **Session 重启记忆持久化** — 停止/启动 Core → 之前保存的记忆仍可搜索
