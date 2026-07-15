import { describe, expect, it } from "vitest";
import {
  categoryConfig,
  formatTimestamp,
  roleConfig,
} from "../src/components/agent-session-format";
import { createTranslator } from "../src/i18n/i18n";
import { en } from "../src/i18n/en";

const timestamp = Date.UTC(2026, 5, 6, 13, 44, 6);

const expectedTimestamp = (locale: "en" | "zh-CN") =>
  new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(timestamp);

describe("formatTimestamp", () => {
  it("formats a numeric timestamp with the application locale", () => {
    expect(formatTimestamp(timestamp, undefined, "en")).toBe(expectedTimestamp("en"));
    expect(formatTimestamp(timestamp, undefined, "zh-CN")).toBe(expectedTimestamp("zh-CN"));
  });

  it("formats a valid ISO label when a numeric timestamp is unavailable", () => {
    expect(formatTimestamp(undefined, "2026-06-06T13:44:06.000Z", "en")).toBe(
      expectedTimestamp("en"),
    );
  });

  it("keeps an invalid label as a safe fallback", () => {
    expect(formatTimestamp(undefined, "not-a-date", "zh-CN")).toBe("not-a-date");
    expect(formatTimestamp(undefined, undefined, "zh-CN")).toBe("");
  });
});

describe("agent session semantic colors", () => {
  const t = createTranslator(en);

  it("keeps non-state roles and categories neutral", () => {
    expect(roleConfig("assistant", t).variant).toBe("default");
    expect(categoryConfig("assistant", t).tone).toBe("text-text-secondary");
    expect(categoryConfig("thinking", t).tone).toBe("text-text-secondary");
  });

  it("preserves semantic colors for warnings and errors", () => {
    expect(roleConfig("tool_call", t).variant).toBe("warning");
    expect(categoryConfig("unknown", t).tone).toBe("text-error");
  });
});
