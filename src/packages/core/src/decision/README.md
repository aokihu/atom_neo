# Decision calls

- `jev-client.ts`: typed HTTP protocol, answer validation and cancellation.
- `choose.ts`: shared limited-choice Jev/LLM simulation for prediction, post-check and continuation arbitration; optional request observation captures the actual model input without provider credentials.
- `choose.test.ts`: real SDK serialization, output budget and arbitration retry boundary.
- Tests inject HTTP or simulation functions; no credentials are needed.

Contracts and configuration: `docs/subsystems/jev-decisions.md`.

预算健康检查使用 chooseDecision 的可选10秒超时与原生失败后一次模拟回退；默认调用行为不变。DecisionModel.beforeCall 为测试注入的限速代理等待点，在单次决策计时前运行，生产模型不设置它。
