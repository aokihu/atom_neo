import { BaseService } from "./base-service";
import { createHash } from "node:crypto";
import { watch, readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";
import { generateText } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import compilerSystemPrompt from "@assets/prompts/agents_compiler_system_prompt.md";

const MAX_HISTORY = 5;

type MetaEntry = { compiledFile: string; compiledAt: number };
type Meta = { currentHash: string; updatedAt: number; entries: Record<string, MetaEntry> };

export class AgentsCompilerService extends BaseService {
  readonly name = "agents-compiler";

  #sandbox: string;
  #apiKey: string;
  #model: string;
  #prompt = "";
  #watcher: ReturnType<typeof watch> | null = null;
  #syncChain: Promise<void> = Promise.resolve();

  constructor(params: { sandbox: string; apiKey: string; model?: string }) {
    super();
    this.#sandbox = params.sandbox;
    this.#apiKey = params.apiKey;
    this.#model = params.model ?? "deepseek-chat";
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
    mkdirSync(`${this.#sandbox}/.atom/compiled_prompts`, { recursive: true });
  }

  #startWatch(): void {
    const path = `${this.#sandbox}/AGENTS.md`;
    if (!existsSync(path)) return;

    this.#watcher = watch(path, { persistent: false }, () => {
      this.#syncChain = this.#syncChain.then(() => this.#sync());
    });
  }

  async #sync(): Promise<void> {
    const agentsPath = `${this.#sandbox}/AGENTS.md`;

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
      const compiledFile = `${this.#sandbox}/.atom/${cached.compiledFile}`;
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
      writeFileSync(`${this.#sandbox}/.atom/${compiledFile}`, compiled, "utf-8");

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

  #metaPath(): string { return `${this.#sandbox}/.atom/agents_meta.json`; }

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
    const dir = `${this.#sandbox}/.atom/compiled_prompts`;
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
    const provider = createDeepSeek({ apiKey: this.#apiKey });
    const model = provider(this.#model);

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
