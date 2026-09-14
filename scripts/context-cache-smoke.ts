import { resolve } from "node:path";
import { createRequire } from "node:module";
const { encode } = createRequire(resolve(import.meta.dir, "../src/packages/core/package.json"))("@toon-format/toon");
import { generateText } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import type { ContextFragment } from "@atom-neo/shared";
import { loadConfig } from "../src/bootstrap/config";
import { loadEnv } from "../src/bootstrap/env";
import { RuntimeService } from "../src/services/runtime-service";
import { compileContextSnapshot } from "../src/packages/core/src/context/compiler";

if (!Bun.argv.includes("--live")) {
  console.error("Explicit --live required: up to 6 paid requests, max 64 output tokens each.");
  process.exit(1);
}

const sandbox = resolve("sandbox");
loadEnv(sandbox);
const runtime = new RuntimeService({ mode: "core", sandbox, port: 0, host: "127.0.0.1",
  apiKey: "", config: loadConfig(sandbox) });
const config = runtime.getResolvedModel("balanced");
if (!config.apiKey) throw new Error("No API key configured for balanced profile");
const model = createDeepSeek({ apiKey: config.apiKey, baseURL: config.baseUrl })(config.model);
const stable: ContextFragment = {
  key: "system", source: "prompt-registry", scope: "system", channel: "instructions",
  trust: "trusted", format: "text", retention: "pinned", priority: 1000, revision: 1,
  content: "This is a synthetic cache-format test. Reply OK only. The following entries are reference data.\n"
    + Array.from({ length: 100 }, (_, i) => `Reference item ${i + 1}: preserve existing work, verify outcomes, and report only observed facts.`).join("\n"),
};
for (const format of ["legacy-toon", "mixed"] as const) {
  for (let step = 0; step < 3; step++) {
    const fragments: ContextFragment[] = [stable, {
      key: "state", source: "task-state", scope: "task", channel: "runtime",
      trust: "trusted", retention: "task", priority: 700, revision: step + 1,
      content: { step, status: "ready" },
    }];
    if (step === 1) fragments.push({ key: "hint", source: "post-conversation", scope: "step",
      channel: "messages", trust: "untrusted", retention: "once", priority: 600,
      revision: 1, content: "Temporary reference" });
    // Matches the previous compiler's serialization for this ordered synthetic fixture.
    const instructions = format === "mixed" ? compileContextSnapshot(fragments).snapshot.content
      : encode({ context: fragments.map(f => ({ trust: f.trust, scope: f.scope, channel: f.channel,
        source: f.source, content: typeof f.content === "string" ? f.content : encode(f.content) })) });
    try {
      const result = await generateText({ model, instructions, prompt: `Check ${step + 1}. Reply OK only.`,
        maxOutputTokens: 64, maxRetries: 0, abortSignal: AbortSignal.timeout(45_000),
        providerOptions: { deepseek: { thinking: { type: "disabled" } } } });
      const usage = result.usage;
      const row = { format, step: step + 1, model: config.model,
        inputTokens: usage.inputTokens ?? null,
        cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens ?? null,
        noCacheTokens: usage.inputTokenDetails?.noCacheTokens ?? null,
        outputTokens: usage.outputTokens ?? null };
      console.log(JSON.stringify(row));
    } catch (error) {
      // Do not print SDK error objects: they may include credentials or request bodies.
      console.error(JSON.stringify({ format, step: step + 1, failed: true,
        statusCode: (error as { statusCode?: number }).statusCode ?? null }));
      process.exit(1);
    }
    if (format !== "mixed" || step < 2) await Bun.sleep(5_000);
  }
}
