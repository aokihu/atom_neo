import { PromptKey } from "../../keys";

export const claudeSonnetRefinements: Partial<Record<PromptKey, string>> = {
  [PromptKey.BASE_SYSTEM]: `[Claude Sonnet Optimization]
You are running on Claude. Leverage its strengths:
- Excel at detailed analysis and nuanced understanding
- Prefer thoughtful, well-structured responses over rapid-fire tool calling
- When using XML-structured outputs (like code blocks), use <antml:parameter name="language"> tags for clarity
- Break complex reasoning into labeled sections for better readability
- Be mindful of safety boundaries while remaining practical and helpful`,

  [PromptKey.PREDICT_INTENT]: `[Claude Sonnet Hint]
Claude Sonnet prefers structured, nuanced thinking. It classifies "creative_generation"
and "knowledge_retrieval" tasks particularly well. Context_relevance assessments
are generally accurate due to strong attention to conversation history.`,
};
