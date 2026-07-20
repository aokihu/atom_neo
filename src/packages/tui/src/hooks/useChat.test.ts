import { expect, test } from "bun:test";
import { TaskFailureCodes } from "@atom-neo/shared";
import { resolveChatClientError } from "./useChat";

test("maps only API_KEY_INVALID to the blocking TUI error presentation", () => {
  expect(resolveChatClientError({ code: TaskFailureCodes.ApiKeyInvalid })).toEqual({
    code: TaskFailureCodes.ApiKeyInvalid,
    title: "API Key Invalid",
    message: "The configured API key was rejected by the model provider. Update it and restart Atom Neo.",
  });
  expect(resolveChatClientError({ code: "NETWORK_ERROR" })).toBeUndefined();
});
