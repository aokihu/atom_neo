# Scripts

- `context-cache-smoke.ts`: existing context cache smoke test.
- `continuation-evidence-experiment.ts`: fixed-corpus native JEV comparisons and parameter ablation; reads credentials from environment, records bounded business evidence and native choices without credentials. Supports --replay for frozen corpora, --holdout for screening and --gate for new scenarios.
- `bump-prompt-version.ts`, `pre-commit`, `setup-git-hooks.sh`: prompt version and Git hook maintenance.

Experiment method and results: `docs/pipelines/progress-evidence-experiment.md`.

- `budget-live-validation.ts`：隔离记忆快照与凭据、固定三问、串行5秒模型代理和10秒题间间隔；决策代理等待发生在调用超时开始前。完成后删除测试 sandbox，保留输出、ToolRecord 和预算时间线。
