# Scripts

- `check-code-size.ts` / `check-code-size.test.ts`: S12 line/function guard over the documented target files; `--json`, `bun run check:size`.
- `context-cache-smoke.ts`: existing context cache smoke test.
- `node-smoke/build.ts`: S10-A Node build smoke (`dist/node/main.js`, `--help`, static Bun imports, TUI import under Node). Requires `bun run build:node`.
- `node-smoke/platform.ts`: S10-B1 platform smoke (config/env, memory FTS5, background shell, glob, schedule); bundled for Node with `bun build --target node`.
- `node-smoke/release.ts`: S10-B1 release artifact smoke; starts the built `dist/node/main.js` under Node and checks health/attach/WS/SIGTERM.
- `node-smoke/run-all.ts`: `smoke:node` orchestrator (build check + platform + release + S9 fake conversation).
- `continuation-evidence-experiment.ts`: fixed-corpus native JEV comparisons and parameter ablation; reads credentials from environment, records bounded business evidence and native choices without credentials. Supports --replay for frozen corpora, --holdout for screening and --gate for new scenarios.
- `bump-prompt-version.ts`, `pre-commit`, `setup-git-hooks.sh`: prompt version and Git hook maintenance.

Experiment method and results: `docs/pipelines/progress-evidence-experiment.md`.

- `budget-live-validation.ts`：隔离记忆快照与凭据、固定三问、串行5秒模型代理和10秒题间间隔；决策代理等待发生在调用超时开始前。完成后删除测试 sandbox，保留输出、ToolRecord 和预算时间线。
