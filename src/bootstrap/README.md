# Bootstrap

- `cli.ts`：五模式参数、端口和模式适用性校验。
- `buildAppCommand` 统一源码/编译入口的命令前缀，由首次配置子进程与菜单执行命令显示复用；Bun 源码使用 `bun run`，编译二进制与 Node 直接执行入口。
- `menu-flow.ts` / `menu.ts`：一次性启动向导状态与普通终端交互，含 `backup` 导出/导入子菜单。
- `menu-history.ts`：`~/.config/atom/menu_history.json` 参数记忆与原子写入。
- `runtime-file.ts`：本机 Core/Gateway 实例发现文件、管理 token 和实例归属清理。
- `config.ts` / `env.ts`：用户配置、运行时 overlay 与环境变量。
- `backup-format.ts` / `backup.ts`：`export` / `import` 子命令；`.atombak` 归档编解码、gzip、可选 scrypt + AES-256-GCM、`.env` merge 与原子写入。
- `first-run.ts`：默认交互模式首次安装流程；通过 shared `spawnProcess` 启动向导子进程。
- `agents.ts`：sandbox 初始化。

启动分流与资源关闭由 `src/main.ts` 持有。TUI/Gateway 控制模式不初始化 Core 服务。

`startup.integration.test.ts` 为隔离进程验收，使用 `fixtures/` 的假 Client 与 PTY 驱动；显式设置 `ATOM_RUN_STARTUP_VALIDATION=1` 运行。常规测试默认跳过这些较重的用例。验收结论见 docs/overview/startup-validation.md。
