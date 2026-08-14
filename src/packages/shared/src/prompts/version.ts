/**
 * 系统提示词版本号（主版本.次版本）
 * 修改 zh.ts 或 en.ts 中的 BASE_SYSTEM 提示词时，必须递增次版本号。
 * 版本号放在提示词最前面，防止 LLM 缓存旧版本提示词。
 */
export const SYSTEM_PROMPT_VERSION = "1.5";
