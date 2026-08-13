import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERSION_FILE = resolve(__dirname, "../src/packages/shared/src/prompts/version.ts");
const PROMPT_FILES = [
  "src/packages/shared/src/prompts/variants/lang/zh.ts",
  "src/packages/shared/src/prompts/variants/lang/en.ts",
];

const staged = execSync("git diff --cached --name-only", { encoding: "utf-8" });
const promptChanged = PROMPT_FILES.some(f => staged.includes(f));

if (!promptChanged) {
  process.exit(0);
}

const content = readFileSync(VERSION_FILE, "utf-8");
const match = content.match(/"(\d+)\.(\d+)"/);
if (!match) {
  console.error("无法解析提示词版本号");
  process.exit(1);
}

const major = match[1];
const minor = Number(match[2]) + 1;
const newContent = content.replace(match[0], `"${major}.${minor}"`);

writeFileSync(VERSION_FILE, newContent);
execSync(`git add ${VERSION_FILE}`);
console.log(`系统提示词版本号: ${major}.${minor}`);
