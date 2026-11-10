# Config Backup — export / import

> **Purpose**: 将 sandbox 的配置与密钥打包迁移到另一台机器或留作备份，支持可选密码加密。

v1.22.0 起可用：直接命令 `atom export` / `atom import`，或 `atom menu` → `backup` 向导。

---

## 1. 范围

| 包含 | 不包含 |
|------|--------|
| `$SANDBOX/config.json` | `.atom/runtime-config.json`（运行时 overlay） |
| `$SANDBOX/.env`（存在时） | Session、Memory、日志、AGENTS.md |

导出的配置保持原始文本，不做 schema 归一化；导入时只做校验，不重写用户格式。

命令在 `src/main.ts` 中最先分流，不会触发 `loadEnv`、`loadConfig`、首次运行向导或 Core 启动。

---

## 2. 命令

```bash
# 导出（默认写入当前目录）
atom export [--sandbox <path>] [-o|--output <file>] [--password] [--force]

# 导入
atom import <archive> [--sandbox <path>] [--password] [--env merge|replace] [--dry-run] [--force]
```

| 参数 | 说明 |
|------|------|
| `--sandbox <path>` | 目标 sandbox，默认当前目录 |
| `-o, --output <file>` | 导出路径；指向目录时自动拼接默认文件名 |
| `--password` | 交互式隐藏输入密码；导出需输入两次 |
| `--env merge` | 默认。归档键覆盖同名键，保留本地独有键 |
| `--env replace` | `.env` 完全还原为归档内容 |
| `--dry-run` | 只解析归档并输出计划，不写盘 |
| `--force` | 覆盖已存在的归档；跳过导入确认；非 TTY 导入必需 |

默认导出文件名：`atom-backup-YYYYMMDD-HHmmss.atombak`（当前工作目录）。

非交互环境通过 `ATOM_BACKUP_PASSWORD` 提供密码：

```bash
ATOM_BACKUP_PASSWORD='...' atom export --password --output backup.atombak
```

密码只允许通过 TTY 提示或环境变量传入，**禁止写在命令行参数中**（会进入 shell history 与进程列表）。

### 菜单向导

`atom menu` 的一级菜单新增 `backup >`，内含两条路径：

```text
backup / export: sandbox → output → encrypt (yes / no)
backup / import: archive → sandbox
```

- 导出默认 `encrypt = yes`；`output` 留空使用默认文件名。
- 导入先校验归档信封：`encryption` 存在才提示密码，未加密归档不出现密码步骤。
- 菜单固定使用 `.env merge`，不提供 `--env` / `--dry-run` / `--force`；导入确认仍由 `runBackupCommand` 完成。
- 历史仅记录归档路径、输出路径和加密选择，密码不进入 `menu_history.json`。

密码输入发生在向导结束、命令执行阶段；密码提示取消或密码错误按菜单的失败重试规则回到当前路径最后一步。导入确认选择 `no` 时不写盘，直接结束菜单。

---

## 3. 归档格式

`.atombak` 是 UTF-8 JSON 信封：

```json
{
  "format": "atom-backup",
  "version": 1,
  "createdAt": "2026-11-10T10:30:00.000Z",
  "appVersion": "1.22.0",
  "files": [
    { "name": "config.json", "size": 745, "sha256": "..." },
    { "name": ".env", "size": 210, "sha256": "..." }
  ],
  "encryption": {
    "alg": "aes-256-gcm",
    "kdf": { "name": "scrypt", "salt": "<base64>", "n": 32768, "r": 8, "p": 1 },
    "iv": "<base64>",
    "tag": "<base64>"
  },
  "payload": "<base64>"
}
```

- `payload` 解码后是 gzip 压缩的 JSON bundle：

  ```json
  { "config.json": "<原始文本>", ".env": "<原始文本>" }
  ```

- 不加密时 `encryption` 为 `null`，`payload` 直接是 `base64(gzip(bundle))`。
- 加密时 `payload` 是 AES-256-GCM 密文，`tag` 为认证标签。
- `files` 记录每个文件的字节数与 SHA-256，导入时逐项校验。
- 只允许 `config.json` 与 `.env` 两个文件名，避免归档被用作任意路径写入。

---

## 4. 加密与密钥

| 项目 | 参数 |
|------|------|
| 密钥派生 | scrypt，N=32768，r=8，p=1，salt 16 字节 |
| 加密 | AES-256-GCM，key 32 字节，IV 12 字节，tag 16 字节 |
| 随机源 | `node:crypto` `randomBytes` |

导出时密码少于 8 位直接拒绝。密码无法找回，丢失后归档不可恢复。

## 5. 安全约束

- 归档文件权限固定 `0600`；导入后的 `.env` 权限 `0600`。
- 无密码导出会打印明文密钥警告。
- 任何密码错误、认证失败、校验和不匹配、版本不支持，都在写盘前中止。
- 导入先完成全部校验，再备份现有文件并原子写入（临时文件 + rename）。
- 压缩后归档上限 10 MB，解压后上限 5 MB，防止异常膨胀。
- 命令输出不打印密钥值；`--dry-run` 只列出 `.env` 键名。

---

## 6. 导出流程

```text
解析参数
  → 校验 sandbox/config.json 存在
  → 读取 config.json + .env（.env 不存在则跳过并提示）
  → 生成 manifest / bundle
  → gzip（可选 scrypt + AES-256-GCM）
  → 写入临时文件（0600）→ rename
  → 输出文件清单与安全提示
```

`--output` 已存在时必须指定 `--force`。

---

## 7. 导入流程

```text
读取归档（大小上限）
  → 解析信封 / 版本校验 / 检测 encryption
  → 未加密：直接解压
  → 已加密：提示密码（TTY 或 ATOM_BACKUP_PASSWORD）并验证 GCM tag
  → 解压 → SHA-256 校验
  → config.json JSON + ConfigSchema 校验
  → 展示摘要并确认（--force 跳过）
  → 备份现有 config.json / .env 为 *.bak.<timestamp>
  → 原子写入
  → 提示重启 Core 使 config.json 生效
```

### `.env` 合并语义

默认 `--env merge`：

| 情况 | 结果 |
|------|------|
| 归档键在本地不存在 | 追加 |
| 归档键在本地存在 | 用归档行覆盖 |
| 本地独有键 | 保留 |
| 注释与空行 | 保留 |

`--env replace` 直接把 `.env` 替换为归档内容。归档不含 `.env` 时，两种模式都不改动本地 `.env`。

`config.json` 在两种模式下都整体替换。

### 导入校验失败

- `config.json` 缺失、JSON 解析失败或 `ConfigSchema` 校验失败 → 中止，目标文件不变。
- 归档校验和、GCM tag、格式版本不匹配 → 中止，目标文件不变。
- 非 TTY 且未指定 `--force` → 中止，提示使用 `--force`。

---

## 8. 错误与退出码

| 场景 | 行为 |
|------|------|
| 成功 / 取消 | 0 |
| 参数错误、密码错误、归档损坏、校验失败 | 1 |
| 非 TTY 缺少密码或确认 | 1，并提示 `ATOM_BACKUP_PASSWORD` / `--force` |

---

## 9. 测试

`src/bootstrap/backup.test.ts` 覆盖：

- 无密码 / 有密码往返编解码
- 错误密码、篡改 payload、校验和不匹配、未知版本
- 缺失 `config.json`、缺失 `.env`
- 归档覆盖保护与 `0600` 权限
- `.env` merge / replace
- 现有文件备份与 `--dry-run`
- 非法 config 拒绝导入
- 路径与键名解析
- 命令层密码检测：未加密归档不提示密码，加密归档缺少密码时报错
- PTY 验收：源码与编译二进制经菜单完成未加密导出/导入，且不出现密码提示

CLI 参数解析覆盖在 `src/bootstrap/cli.test.ts`；菜单向导覆盖在 `src/bootstrap/menu-flow.test.ts` 与 `src/bootstrap/menu-history.test.ts`，端到端菜单路径在 `src/bootstrap/startup.integration.test.ts`（需 `ATOM_RUN_STARTUP_VALIDATION=1`）。

---

## 10. 限制

- 不迁移运行时 overlay、Session、Memory 等 `.atom/` 数据。
- 归档格式版本固定为 1；后续字段扩展需提升版本并保持向后兼容。
- 导入不会自动重启 Core，也不会热重载配置。
- 无密码归档等同明文密钥文件，必须自行妥善保管。
