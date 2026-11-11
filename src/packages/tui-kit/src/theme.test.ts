import { expect, test } from "bun:test";
import { DEFAULT_THEME, THEME_NAMES } from "@atom-neo/shared";
import { THEMES, getTheme } from "./theme";

test("palette keys match THEME_NAMES", () => {
  expect(Object.keys(THEMES).sort()).toEqual([...THEME_NAMES].sort());
  for (const name of THEME_NAMES) {
    expect(getTheme(name).colors).toBe(THEMES[name]);
  }
});

test("unknown theme falls back to DEFAULT_THEME", () => {
  expect(getTheme("does-not-exist").colors).toBe(THEMES[DEFAULT_THEME]);
  expect(getTheme().colors).toBe(THEMES[DEFAULT_THEME]);
});
