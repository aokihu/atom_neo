import { expect, test } from "bun:test";
import { TaskFailureCodes } from "@atom-neo/shared";
import { resolveTaskFailureCode } from "./server";

test("preserves stable task failure codes for WebSocket payloads", () => {
  expect(resolveTaskFailureCode({ code: TaskFailureCodes.ApiKeyInvalid }, false))
    .toBe(TaskFailureCodes.ApiKeyInvalid);
  expect(resolveTaskFailureCode(new Error("offline"), false)).toBeUndefined();
  expect(resolveTaskFailureCode({ code: TaskFailureCodes.ApiKeyInvalid }, true))
    .toBe(TaskFailureCodes.PipelineAborted);
});
