/**
 * Pure helpers for the manifest.config driven Gateway instance form.
 * Nothing here persists state: cancelling the form simply means the caller
 * drops the draft without forwarding it to the persistence layer.
 */

/** Structural copy of manifest.config; config-tui must not import the gateway package. */
export type GatewayInstanceField = {
  label: string;
  type: "string";
  required?: boolean;
  secret?: boolean;
  enum?: string[];
  default?: string;
  env?: string;
};

export type GatewayInstanceFields = Record<string, GatewayInstanceField>;

export type GatewayInstanceValues = Record<string, string>;

export type GatewayInstanceValidation = {
  ok: boolean;
  errors: Record<string, string>;
  values: GatewayInstanceValues;
};

export type GatewayInstanceDraft = {
  values: GatewayInstanceValues;
};

/** Fixed-width mask so the row never leaks the secret's value or length. */
export const SECRET_MASK = "••••••";

/** Seed every declared field. Secrets always start blank, even when editing. */
export function initialFieldValues(
  fields: GatewayInstanceFields,
  existing: GatewayInstanceValues = {},
): GatewayInstanceValues {
  const values: GatewayInstanceValues = {};
  for (const [name, field] of Object.entries(fields)) {
    values[name] = field.secret ? "" : existing[name] ?? field.default ?? "";
  }
  return values;
}

/** Masked value for list rows; non-secret fields are returned unchanged. */
export function maskFieldValue(field: GatewayInstanceField, value: string): string {
  if (!field.secret) return value;
  return value === "" ? "" : SECRET_MASK;
}

/**
 * Apply non-secret defaults, then check required and enum constraints.
 * Unknown keys are ignored and the input object is never mutated.
 */
export function validateFieldValues(
  fields: GatewayInstanceFields,
  values: GatewayInstanceValues,
): GatewayInstanceValidation {
  const normalized: GatewayInstanceValues = {};
  const errors: Record<string, string> = {};

  for (const [name, field] of Object.entries(fields)) {
    const given = values[name];
    const value = given === undefined
      ? field.secret ? "" : field.default ?? ""
      : given;
    normalized[name] = value;

    if (field.required && value.trim() === "") {
      errors[name] = `${field.label} is required`;
    } else if (field.enum && value !== "" && !field.enum.includes(value)) {
      errors[name] = `${field.label} must be one of: ${field.enum.join(", ")}`;
    }
  }

  return { ok: Object.keys(errors).length === 0, errors, values: normalized };
}

/**
 * Split validated values into CLI args and credentials.
 * Blank optional values are omitted so they do not create empty args or
 * empty `.env` credential references that would fail the startup resolver.
 */
export function splitFieldValues(
  fields: GatewayInstanceFields,
  values: GatewayInstanceValues,
): { clientArgs: GatewayInstanceValues; secrets: GatewayInstanceValues } {
  const clientArgs: GatewayInstanceValues = {};
  const secrets: GatewayInstanceValues = {};

  for (const [name, field] of Object.entries(fields)) {
    const value = values[name];
    if (value === undefined || value === "") continue;
    if (field.secret) secrets[name] = value;
    else clientArgs[name] = value;
  }

  return { clientArgs, secrets };
}

/** Start an immutable draft; cancellation is dropping it without persisting. */
export function beginDraft(
  fields: GatewayInstanceFields,
  existing: GatewayInstanceValues = {},
): GatewayInstanceDraft {
  return { values: initialFieldValues(fields, existing) };
}

/** Update one declared field without mutating the previous draft. */
export function setDraftValue(
  fields: GatewayInstanceFields,
  draft: GatewayInstanceDraft,
  name: string,
  value: string,
): GatewayInstanceDraft {
  if (!(name in fields) || draft.values[name] === value) return draft;
  return { values: { ...draft.values, [name]: value } };
}
