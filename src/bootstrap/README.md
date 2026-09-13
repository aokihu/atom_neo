# Bootstrap

- `cli.ts`：五模式参数、端口和模式适用性校验。
- `runtime-file.ts`：本机 Core/Gateway 实例发现文件、管理 token 和实例归属清理。
- `config.ts` / `env.ts`：用户配置、运行时 overlay 与环境变量。
- `first-run.ts`：默认交互模式首次安装流程。
- `agents.ts`：sandbox 初始化。

启动分流与资源关闭由 `src/main.ts` 持有。TUI/Gateway 控制模式不初始化 Core 服务。

`startup.integration.test.ts` 为隔离进程验收，使用 `fixtures/` 的假 Client 与 PTY 驱动；显式设置 `ATOM_RUN_STARTUP_VALIDATION=1` 运行。常规测试默认跳过这些较重的用例。验收结论见 docs/overview/startup-validation.md。
