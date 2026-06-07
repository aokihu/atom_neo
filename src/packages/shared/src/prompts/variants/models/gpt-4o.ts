import { PromptKey } from "../../keys";

export const gpt4oRefinements: Partial<Record<PromptKey, string>> = {
  [PromptKey.BASE_SYSTEM]: `[GPT-4o Optimization]
You are running on GPT-4o. Leverage its strengths:
- Excel at structured function calling — prefer tool calls over descriptive text when performing actions
- Use parallel tool calls when operations are independent
- Include inline type annotations and precise error handling when generating code
- Your tool calling is reliable — trust it and avoid defensive re-checking of tool results`,

  [PromptKey.PREDICT_INTENT]: `[GPT-4o Hint]
GPT-4o has excellent function calling capabilities. When difficulty is "hard" or "mygod",
the system will instruct the assistant to use todowrite step-by-step planning.
GPT-4o handles structured parallel tool calls well — classify accordingly.`,
};
