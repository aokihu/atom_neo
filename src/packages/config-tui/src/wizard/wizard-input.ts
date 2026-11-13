import { parsePortValue } from "@atom-neo/shared";

export function addModel(models: string[], name: string): string[] {
  const trimmed = name.trim();
  if (!trimmed) return models;
  if (models.includes(trimmed)) return models;
  return [...models, trimmed];
}

export function removeModelAt(models: string[], index: number): string[] {
  if (index < 0 || index >= models.length) return models;
  return models.filter((_, i) => i !== index);
}

export function parseContextLimit(text: string): number | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value <= 0) return undefined;
  return value;
}

export function isDecisionEndpoint(value?: string): boolean {
  if (!value || !/^https?:\/\//i.test(value)) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

export function parsePort(text: string): number | undefined {
  return parsePortValue(text, { allowZero: false });
}
