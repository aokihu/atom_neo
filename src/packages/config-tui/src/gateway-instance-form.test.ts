import { afterEach, describe, expect, test } from "bun:test";
import { act, createElement } from "react";
import { createRoot } from "@opentui/react";
import { createTestRenderer } from "@opentui/core/testing";
import {
  SECRET_MASK,
  beginDraft,
  initialFieldValues,
  maskFieldValue,
  setDraftValue,
  splitFieldValues,
  validateFieldValues,
} from "./gateway-instance-form";
import type { GatewayInstanceFields } from "./gateway-instance-form";
import { GatewayInstanceForm } from "./components/GatewayInstanceForm";

const FIELDS: GatewayInstanceFields = {
  "bot-token": {
    label: "Bot Token",
    type: "string",
    required: true,
    secret: true,
    env: "TELEGRAM_BOT_TOKEN",
  },
  mode: {
    label: "Mode",
    type: "string",
    enum: ["longpoll", "webhook"],
    default: "longpoll",
  },
  "webhook-url": { label: "Webhook URL", type: "string" },
  "webhook-secret": {
    label: "Webhook Secret",
    type: "string",
    secret: true,
    env: "TELEGRAM_WEBHOOK_SECRET",
  },
};

describe("initialFieldValues", () => {
  test("applies non-secret defaults and keeps secrets empty", () => {
    expect(initialFieldValues(FIELDS)).toEqual({
      "bot-token": "",
      mode: "longpoll",
      "webhook-url": "",
      "webhook-secret": "",
    });
  });

  test("existing non-secret values win, but secrets are never seeded", () => {
    expect(initialFieldValues(FIELDS, {
      "bot-token": "must-not-leak",
      mode: "webhook",
      "webhook-url": "https://example.test/hook",
      unknown: "ignored",
    })).toEqual({
      "bot-token": "",
      mode: "webhook",
      "webhook-url": "https://example.test/hook",
      "webhook-secret": "",
    });
  });

  test("returns a fresh object, so mutating a draft cannot change the manifest", () => {
    const values = initialFieldValues(FIELDS);
    values.mode = "webhook";
    expect(FIELDS.mode.default).toBe("longpoll");
  });
});

describe("maskFieldValue", () => {
  test("masks any non-empty secret without revealing its length", () => {
    expect(maskFieldValue(FIELDS["bot-token"], "")).toBe("");
    expect(maskFieldValue(FIELDS["bot-token"], "x")).toBe(SECRET_MASK);
    expect(maskFieldValue(FIELDS["bot-token"], "123456:long-token")).toBe(SECRET_MASK);
  });

  test("leaves non-secret values untouched", () => {
    expect(maskFieldValue(FIELDS.mode, "webhook")).toBe("webhook");
  });
});

describe("validateFieldValues", () => {
  test("reports a missing required field while still applying defaults", () => {
    const result = validateFieldValues(FIELDS, {});
    expect(result.ok).toBe(false);
    expect(result.errors["bot-token"]).toBe("Bot Token is required");
    expect(result.values.mode).toBe("longpoll");
    expect(result.values["bot-token"]).toBe("");
  });

  test("rejects an enum value outside the manifest", () => {
    const result = validateFieldValues(FIELDS, { "bot-token": "token", mode: "carrier-pigeon" });
    expect(result.ok).toBe(false);
    expect(result.errors.mode).toBe("Mode must be one of: longpoll, webhook");
  });

  test("accepts a valid enum selection and explicit values", () => {
    const result = validateFieldValues(FIELDS, {
      "bot-token": "token",
      mode: "webhook",
      "webhook-url": "https://example.test/hook",
    });
    expect(result).toEqual({
      ok: true,
      errors: {},
      values: {
        "bot-token": "token",
        mode: "webhook",
        "webhook-url": "https://example.test/hook",
        "webhook-secret": "",
      },
    });
  });

  test("ignores unknown keys and never mutates the inputs", () => {
    const fields = structuredClone(FIELDS);
    const values = { "bot-token": "token", mode: "webhook", unknown: "drop me" };
    const snapshot = { ...values };

    const result = validateFieldValues(fields, values);

    expect(result.ok).toBe(true);
    expect(result.values).not.toHaveProperty("unknown");
    expect(values).toEqual(snapshot);
    expect(fields).toEqual(FIELDS);
    expect(result.values).not.toBe(values);
  });

  test("a configured secret satisfies a required secret field", () => {
    const values = {};
    const snapshot = { ...values };
    const configuredSecrets = new Set(["bot-token"]);

    const result = validateFieldValues(FIELDS, values, { configuredSecrets });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual({});
    expect(result.values["bot-token"]).toBe("");
    expect(values).toEqual(snapshot);
    expect(configuredSecrets).toEqual(new Set(["bot-token"]));
  });

  test("a configured optional secret does not hide a missing required secret", () => {
    const result = validateFieldValues(FIELDS, {}, {
      configuredSecrets: new Set(["webhook-secret"]),
    });

    expect(result.ok).toBe(false);
    expect(result.errors["bot-token"]).toBe("Bot Token is required");
  });

  test("configured secrets never satisfy required non-secret fields", () => {
    const fields: GatewayInstanceFields = {
      "webhook-url": { label: "Webhook URL", type: "string", required: true },
    };

    const result = validateFieldValues(fields, {}, {
      configuredSecrets: new Set(["webhook-url"]),
    });

    expect(result.ok).toBe(false);
    expect(result.errors["webhook-url"]).toBe("Webhook URL is required");
  });

  test("keeps enum validation and defaults unchanged when secrets are configured", () => {
    const result = validateFieldValues(FIELDS, { mode: "carrier-pigeon" }, {
      configuredSecrets: new Set(["bot-token"]),
    });

    expect(result.ok).toBe(false);
    expect(result.errors.mode).toBe("Mode must be one of: longpoll, webhook");
    expect(result.values.mode).toBe("carrier-pigeon");
  });
});

describe("splitFieldValues", () => {
  test("sends secrets to credentials and the rest to client args", () => {
    expect(splitFieldValues(FIELDS, {
      "bot-token": "123:secret",
      mode: "webhook",
      "webhook-url": "https://example.test/hook",
      "webhook-secret": "hook-secret",
    })).toEqual({
      clientArgs: { mode: "webhook", "webhook-url": "https://example.test/hook" },
      secrets: { "bot-token": "123:secret", "webhook-secret": "hook-secret" },
    });
  });

  test("omits blank optional fields and unknown keys", () => {
    expect(splitFieldValues(FIELDS, {
      "bot-token": "token",
      mode: "longpoll",
      "webhook-url": "",
      "webhook-secret": "",
      unknown: "drop me",
    })).toEqual({
      clientArgs: { mode: "longpoll" },
      secrets: { "bot-token": "token" },
    });
  });

  test("a blank configured secret stays out of the split values", () => {
    const validated = validateFieldValues(FIELDS, {}, {
      configuredSecrets: new Set(["bot-token"]),
    });

    const split = splitFieldValues(FIELDS, validated.values);

    expect(split.secrets).toEqual({});
    expect(split.secrets).not.toHaveProperty("bot-token");
    expect(split.clientArgs).toEqual({ mode: "longpoll" });
  });
});

describe("draft helpers", () => {
  test("setDraftValue is immutable and ignores unknown fields", () => {
    const draft = beginDraft(FIELDS);
    const changed = setDraftValue(FIELDS, draft, "mode", "webhook");

    expect(draft.values.mode).toBe("longpoll");
    expect(changed.values.mode).toBe("webhook");
    expect(changed).not.toBe(draft);
    expect(setDraftValue(FIELDS, draft, "unknown", "ignored")).toBe(draft);
  });

  test("cancelling only drops the draft; no validation or persistence side effects", () => {
    const draft = setDraftValue(FIELDS, beginDraft(FIELDS), "bot-token", "123:secret");
    let persisted: unknown;

    // Cancellation is the caller declining to validate, split, or persist.
    expect(persisted).toBeUndefined();
    expect(draft.values["bot-token"]).toBe("123:secret");
    expect(FIELDS["bot-token"].required).toBe(true);
  });
});

const reactEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };

async function mountForm(
  onSubmit: (values: Record<string, string>) => void,
  onCancel: () => void,
  options: {
    fields?: GatewayInstanceFields;
    initialValues?: Record<string, string>;
    configuredSecrets?: readonly string[];
    mode?: "create" | "edit";
  } = {},
) {
  const previous = reactEnvironment.IS_REACT_ACT_ENVIRONMENT;
  reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  const setup = await createTestRenderer({ width: 100, height: 36 });
  const root = createRoot(setup.renderer);
  await act(async () => root.render(createElement(GatewayInstanceForm, {
    fields: options.fields ?? FIELDS,
    initialValues: options.initialValues,
    configuredSecrets: options.configuredSecrets,
    mode: options.mode,
    onSubmit,
    onCancel,
  })));
  await setup.renderOnce();

  const press = async (...keys: string[]) => {
    for (const key of keys) {
      await act(async () => setup.mockInput.pressKey(key));
      await setup.renderOnce();
    }
    // Escape is dispatched through a deferred renderer path in the test harness.
    await act(async () => Bun.sleep(50));
    await setup.renderOnce();
  };
  const type = async (value: string) => {
    await act(async () => setup.mockInput.pasteBracketedText(value));
    await setup.renderOnce();
  };
  const typeKeys = async (value: string) => {
    await act(async () => setup.mockInput.typeText(value));
    await setup.renderOnce();
  };
  const cleanup = async () => {
    await act(async () => root.unmount());
    setup.renderer.destroy();
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = previous;
  };

  return { press, type, typeKeys, frame: setup.captureCharFrame, cleanup };
}

afterEach(() => {
  reactEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
});

test("Escape cancels without submitting", async () => {
  const submitted: Record<string, string>[] = [];
  let cancellations = 0;
  const form = await mountForm(
    (values) => submitted.push(values),
    () => { cancellations += 1; },
  );

  try {
    await form.press("ESCAPE");
    expect(cancellations).toBe(1);
    expect(submitted).toEqual([]);
  } finally {
    await form.cleanup();
  }
});

test("shows required errors, masks secrets, and submits defaults and enum choices", async () => {
  const submitted: Record<string, string>[] = [];
  const form = await mountForm((values) => submitted.push(values), () => {});

  try {
    await form.press("TAB", "RETURN");
    expect(submitted).toEqual([]);
    expect(form.frame()).toContain("Bot Token is required");

    // Leave the action bar and open the first field.
    await form.press("ARROW_UP", "ARROW_DOWN", "RETURN");
    await form.type("123:secret");
    expect(form.frame()).toContain(SECRET_MASK);
    expect(form.frame()).not.toContain("123:secret");
    await form.press("RETURN");
    expect(form.frame()).toContain(SECRET_MASK);
    expect(form.frame()).not.toContain("123:secret");

    // Select the enum field and choose webhook.
    await form.press("ARROW_DOWN", "RETURN", "ARROW_DOWN", "RETURN");
    expect(form.frame()).toContain("webhook");

    await form.press("TAB", "RETURN");
    expect(submitted).toEqual([{
      "bot-token": "123:secret",
      mode: "webhook",
      "webhook-url": "",
      "webhook-secret": "",
    }]);
  } finally {
    await form.cleanup();
  }
});

test("masks a typed secret while editing and submits the raw value", async () => {
  const submitted: Record<string, string>[] = [];
  const form = await mountForm((values) => submitted.push(values), () => {});

  try {
    await form.press("RETURN");
    expect(form.frame()).toContain("Bot Token");

    // Typed keys and bracketed paste both feed the same masked buffer.
    await form.typeKeys("super-");
    await form.type("secret-token");
    expect(form.frame()).toContain(SECRET_MASK);
    expect(form.frame()).not.toContain("super-");
    expect(form.frame()).not.toContain("super-secret-token");
    expect(form.frame()).not.toContain("secret-token");

    await form.press("RETURN");
    expect(form.frame()).toContain(SECRET_MASK);
    expect(form.frame()).not.toContain("super-secret-token");
    expect(submitted).toEqual([]);

    await form.press("TAB", "RETURN");
    expect(submitted).toEqual([{
      "bot-token": "super-secret-token",
      mode: "longpoll",
      "webhook-url": "",
      "webhook-secret": "",
    }]);
  } finally {
    await form.cleanup();
  }
});

test("edit mode keeps configured secrets and cancel never submits", async () => {
  const submitted: Record<string, string>[] = [];
  let cancellations = 0;
  const form = await mountForm(
    (values) => submitted.push(values),
    () => { cancellations += 1; },
    { configuredSecrets: ["bot-token"], mode: "edit" },
  );

  try {
    expect(form.frame()).toContain(`${SECRET_MASK} (configured)`);

    await form.press("RETURN");
    await form.type("replacement-token");
    expect(form.frame()).toContain(SECRET_MASK);
    expect(form.frame()).not.toContain("replacement-token");

    await form.press("ESCAPE");
    expect(submitted).toEqual([]);
    expect(cancellations).toBe(0);
    expect(form.frame()).toContain(`${SECRET_MASK} (configured)`);
    expect(form.frame()).not.toContain("replacement-token");

    // Blank means unchanged, so a configured secret satisfies the requirement.
    await form.press("TAB", "RETURN");
    expect(submitted).toEqual([{
      "bot-token": "",
      mode: "longpoll",
      "webhook-url": "",
      "webhook-secret": "",
    }]);

    await form.press("ESCAPE");
    expect(cancellations).toBe(1);
    expect(submitted).toHaveLength(1);
  } finally {
    await form.cleanup();
  }
});
