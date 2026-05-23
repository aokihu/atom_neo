import { BaseService } from "./base-service";
import { createHash } from "node:crypto";
import { watch, readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { generateText } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import compilerSystemPrompt from "@assets/prompts/agents_compiler_system_prompt.md";
import type { RuntimeService } from "./runtime-service";

const MAX_HISTORY = 5;

type MetaEntry = { compiledFile: string; compiledAt: number };
type Meta = { currentHash: string; updatedAt: number; entries: Record<string, MetaEntry> };

export class AgentsCompilerService extends BaseService {
  readonly name = "agents-compiler";

  #runtime: RuntimeService;
  #prompt = "";
  #watcher: ReturnType<typeof watch> | null = null;
  #syncChain: Promise<void> = Promise.resolve();

  constructor(params: { runtime: RuntimeService }) {
    super();
    this.#runtime = params.runtime;
  }

  getCompiledPrompt(): string {
    return this.#prompt;
  }

  async start(): Promise<void> {
    await super.start();
    this.#ensureDirs();
    this.#startWatch();
    await this.#sync();
  }

  async stop(): Promise<void> {
    if (this.#watcher) { this.#watcher.close(); this.#watcher = null; }
    await super.stop();
  }

  // == internal ==

  #ensureDirs(): void {
    mkdirSync(`${this.#runtime.sandboxDir}/.atom/compiled_prompts`, { recursive: true });
  }

  #startWatch(): void {
    const path = `${this.#runtime.sandboxDir}/AGENTS.md`;
    if (!existsSync(path)) return;

    this.#watcher = watch(path, { persistent: false }, () => {
      this.#syncChain = this.#syncChain.then(() => this.#sync());
    });
  }

  async #sync(): Promise<void> {
    const agentsPath = `${this.#runtime.sandboxDir}/AGENTS.md`;

    if (!existsSync(agentsPath)) {
      this.#prompt = "";
      return;
    }

    const raw = readFileSync(agentsPath, "utf-8");
    if (!raw.trim()) {
      this.#prompt = "";
      return;
    }

    const hash = this.#computeHash(raw);
    const meta = this.#readMeta();

    // Cache hit
    const cached = meta.entries[hash];
    if (cached) {
      const compiledFile = `${this.#runtime.sandboxDir}/.atom/${cached.compiledFile}`;
      if (existsSync(compiledFile)) {
        this.#prompt = readFileSync(compiledFile, "utf-8");
        meta.currentHash = hash;
        meta.updatedAt = Date.now();
        this.#writeMeta(meta);
        return;
      }
    }

    // Cache miss — compile
    try {
      const compiled = await this.#compileWithLLM(raw);
      const compiledFile = `compiled_prompts/${hash}.md`;
      writeFileSync(`${this.#runtime.sandboxDir}/.atom/${compiledFile}`, compiled, "utf-8");

      meta.entries[hash] = { compiledFile, compiledAt: Date.now() };
      meta.currentHash = hash;
      meta.updatedAt = Date.now();

      this.#pruneHistory(meta);
      this.#reconcileFiles(meta);

      this.#writeMeta(meta);
      this.#prompt = compiled;
    } catch {
      // Compilation failed, keep previous prompt
    }
  }

  #computeHash(content: string): string {
    return createHash("sha256").update(content).digest("hex");
  }

  #metaPath(): string { return `${this.#runtime.sandboxDir}/.atom/agents_meta.json`; }

  #readMeta(): Meta {
    try {
      return JSON.parse(readFileSync(this.#metaPath(), "utf-8"));
    } catch {
      return { currentHash: "", updatedAt: 0, entries: {} };
    }
  }

  #writeMeta(meta: Meta): void {
    writeFileSync(this.#metaPath(), JSON.stringify(meta, null, 2), "utf-8");
  }

  #pruneHistory(meta: Meta): void {
    const entries = Object.entries(meta.entries)
      .sort((a, b) => a[1].compiledAt - b[1].compiledAt);

    while (entries.length > MAX_HISTORY) {
      const [hash, entry] = entries.shift()!;
      if (hash === meta.currentHash) {
        entries.push([hash, entry]); // preserve current
        continue;
      }
      delete meta.entries[hash];
    }
  }

  #reconcileFiles(meta: Meta): void {
    const dir = `${this.#runtime.sandboxDir}/.atom/compiled_prompts`;
    if (!existsSync(dir)) return;

    const validFiles = new Set(
      Object.values(meta.entries).map((e) => resolve(dir, e.compiledFile.split("/").pop()!)),
    );

    for (const file of readdirSync(dir)) {
      const full = resolve(dir, file);
      if (!validFiles.has(full)) unlinkSync(full);
    }
  }

  async #compileWithLLM(raw: string): Promise<string> {
    const provider = createDeepSeek({ apiKey: this.#runtime.apiKey });
    const model = provider("deepseek-chat");

    const result = await generateText({
      model,
      messages: [
        { role: "system" as const, content: compilerSystemPrompt },
        { role: "user" as const, content: raw },
      ],
      maxTokens: 2048,
    });

    return result.text.trim();
  }
}
