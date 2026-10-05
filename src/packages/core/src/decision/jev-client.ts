/** HTTP client for Jev-compatible typed decisions, independent of the AI SDK. */
import { z } from "zod";

type QuestionText = string | Record<string, unknown> | unknown[];

export type JevQuestion =
  | { type: "choice"; instructions: QuestionText; criteria: Record<string, QuestionText | null> }
  | { type: "noul"; instructions: QuestionText; criteria?: { true: QuestionText; false: QuestionText } }
  | { type: "score"; instructions: QuestionText; criteria: QuestionText[] };

const ProbabilitySchema = z.number().min(0).max(1);
const ProbabilitiesSchema = z.record(z.string(), ProbabilitySchema);
const AnswerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("choice"), choice: z.string(), probabilities: ProbabilitiesSchema, confidence: ProbabilitySchema }),
  z.object({ type: z.literal("noul"), noul: ProbabilitySchema }),
  z.object({ type: z.literal("score"), score: z.number().finite(), probabilities: ProbabilitiesSchema, confidence: ProbabilitySchema, legend: z.record(z.string(), z.string()) }),
]);
const ResponseSchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), AnswerSchema),
  usage: z.object({ input_tokens: z.number().optional(), output_tokens: z.number().optional(), cost: z.number().optional() }).optional(),
});

export type JevAnswer = z.infer<typeof AnswerSchema>;
export type JevResponse = z.infer<typeof ResponseSchema>;

export async function callJev(params: {
  apiKey: string;
  model: string;
  endpoint: string;
  state: QuestionText;
  questions: Record<string, JevQuestion>;
  abortSignal?: AbortSignal;
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
}): Promise<JevResponse> {
  if (!params.apiKey) throw new Error("Jev requires an API key");
  if (!params.model) throw new Error("Jev requires a model");
  if (!params.endpoint) throw new Error("Jev requires a configured endpoint");
  if (Object.keys(params.questions).length === 0) throw new Error("Jev requires at least one question");
  const endpoint = new URL(params.endpoint);
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") throw new Error("Jev endpoint must use HTTP or HTTPS");

  const fetchImpl = params.fetchImpl ?? fetch;
  const response = await fetchImpl(endpoint.href, {
    method: "POST",
    headers: { Authorization: `Bearer ${params.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: params.model, state: params.state, questions: params.questions }),
    signal: params.abortSignal,
  });
  if (!response.ok) throw new Error(`Jev request failed with HTTP ${response.status}`);

  const parsed = ResponseSchema.parse(await response.json());
  for (const [id, question] of Object.entries(params.questions)) {
    const answer = parsed.answers[id];
    if (!answer || answer.type !== question.type) throw new Error(`Jev answer missing or mismatched: ${id}`);
    if (question.type === "choice" && answer.type === "choice") {
      if (!(answer.choice in question.criteria)) throw new Error(`Jev choice outside criteria: ${id}`);
      if (Object.keys(question.criteria).some(option => answer.probabilities[option] === undefined)) {
        throw new Error(`Jev choice probabilities incomplete: ${id}`);
      }
    }
    if (question.type === "score" && answer.type === "score") {
      if (answer.score < 0 || answer.score > question.criteria.length - 1) throw new Error(`Jev score outside criteria: ${id}`);
    }
  }
  return parsed;
}
