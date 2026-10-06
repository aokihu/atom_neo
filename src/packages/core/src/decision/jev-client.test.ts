/** Contract tests for the Jev HTTP client without external credentials. */
import { describe, expect, test } from "bun:test";
import { callJev } from "./jev-client";

const endpoint = "https://decisions.example.test/v1";

const questions = {
  route: { type: "choice" as const, instructions: "Choose a route", criteria: { answer: "Answered", retry: "Retry" } },
  repeated: { type: "noul" as const, instructions: "Is this repeated?" },
  urgency: { type: "score" as const, instructions: "Rate urgency", criteria: ["low", "high"] },
};

const validAnswer = {
  model: "typesafe/jev-1.13",
  answers: {
    route: { type: "choice", choice: "answer", probabilities: { answer: 0.9, retry: 0.1 }, confidence: 0.8 },
    repeated: { type: "noul", noul: 0.2 },
    urgency: { type: "score", score: 0.4, probabilities: { "0": 0.6, "1": 0.4 }, confidence: 0.4, legend: { "0": "low", "1": "high" } },
  },
};

describe("callJev", () => {
  test("sends the Decisions request and parses typed answers", async () => {
    let sentUrl = "";
    let sentInit: RequestInit | undefined;
    const signal = new AbortController().signal;
    const result = await callJev({
      apiKey: "test-key",
      model: "typesafe/jev-1.13",
      endpoint,
      state: { userInput: "hello" },
      questions,
      abortSignal: signal,
      fetchImpl: async (url, init) => {
        sentUrl = url;
        sentInit = init;
        return Response.json(validAnswer);
      },
    });

    expect(sentUrl).toBe(endpoint);
    expect(sentInit?.method).toBe("POST");
    expect(sentInit?.headers).toEqual({ Authorization: "Bearer test-key", "Content-Type": "application/json" });
    expect(sentInit?.signal).toBe(signal);
    expect(JSON.parse(String(sentInit?.body))).toEqual({ model: "typesafe/jev-1.13", state: { userInput: "hello" }, questions });
    expect(result.answers.route).toMatchObject({ choice: "answer", confidence: 0.8 });
  });

  test("uses a configured endpoint", async () => {
    let sentUrl = "";
    await callJev({ apiKey: "key", model: "model", endpoint: "https://example.test/decisions", state: "hello", questions, fetchImpl: async (url) => {
      sentUrl = url;
      return Response.json(validAnswer);
    } });
    expect(sentUrl).toBe("https://example.test/decisions");
  });

  test("rejects HTTP failures without returning response bodies", async () => {
    await expect(callJev({ apiKey: "key", model: "model", endpoint, state: "hello", questions, fetchImpl: async () => new Response("secret", { status: 401 }) }))
      .rejects.toThrow("HTTP 401");
  });

  test("rejects missing and invalid choices", async () => {
    const missing = { ...validAnswer, answers: { ...validAnswer.answers, route: undefined } };
    await expect(callJev({ apiKey: "key", model: "model", endpoint, state: "hello", questions, fetchImpl: async () => Response.json(missing) }))
      .rejects.toThrow();

    const invalid = { ...validAnswer, answers: { ...validAnswer.answers, route: { ...validAnswer.answers.route, choice: "outside" } } };
    await expect(callJev({ apiKey: "key", model: "model", endpoint, state: "hello", questions, fetchImpl: async () => Response.json(invalid) }))
      .rejects.toThrow("outside criteria");
  });

  test("rejects requests without credentials or questions", async () => {
    await expect(callJev({ apiKey: "", model: "model", endpoint, state: "hello", questions })).rejects.toThrow("requires an API key");
    await expect(callJev({ apiKey: "key", model: "model", endpoint, state: "hello", questions: {} })).rejects.toThrow("at least one question");
    await expect(callJev({ apiKey: "key", model: "model", endpoint: "", state: "hello", questions })).rejects.toThrow("configured endpoint");
    await expect(callJev({ apiKey: "key", model: "model", endpoint: "file:///tmp/decision", state: "hello", questions })).rejects.toThrow("HTTP or HTTPS");
  });
});
