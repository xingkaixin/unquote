import { describe, expect, it } from "vitest";
import {
  categoryConfig,
  formatEventMeta,
  formatTimestamp,
  roleConfig,
} from "../src/components/agent-session-format";
import { createTranslator } from "../src/i18n/i18n";
import type { Locale } from "../src/i18n/i18n";
import { en } from "../src/i18n/en";

const timestamp = Date.UTC(2026, 5, 6, 13, 44, 6);

const expectedTimestamp = (locale: Locale) =>
  new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(timestamp);

describe("formatTimestamp", () => {
  it("formats a numeric timestamp with the application locale", () => {
    expect(formatTimestamp(timestamp, undefined, "en")).toBe(expectedTimestamp("en"));
    expect(formatTimestamp(timestamp, undefined, "zh-CN")).toBe(expectedTimestamp("zh-CN"));
    expect(formatTimestamp(timestamp, undefined, "ja")).toBe(expectedTimestamp("ja"));
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

  it("keeps conversation categories on the neutral message dot", () => {
    expect(categoryConfig("assistant", t).dot).toBe("var(--dot-message)");
    expect(categoryConfig("thinking", t).dot).toBe("var(--dot-message)");
    expect(categoryConfig("meta", t).dot).toBe("var(--dot-event)");
  });

  it("preserves semantic dots for tools and unparsed lines", () => {
    expect(categoryConfig("tool", t).dot).toBe("var(--dot-tool)");
    expect(categoryConfig("unknown", t).dot).toBe("var(--dot-error)");
  });

  it("labels every role and leaves it to the caller to render", () => {
    expect(roleConfig("assistant", t)).toEqual({ label: "Assistant", icon: expect.anything() });
    expect(roleConfig("tool_call", t).label).toBe("Tool call");
  });
});

describe("formatEventMeta", () => {
  const t = createTranslator(en);

  it("joins the parts that exist", () => {
    expect(formatEventMeta(3, "10:00:00", 2, t)).toBe("Line 3 · 10:00:00 · Turn 2");
  });

  it("drops a missing time and a missing turn instead of leaving a separator", () => {
    expect(formatEventMeta(3, "", undefined, t)).toBe("Line 3");
    expect(formatEventMeta(3, "10:00:00", undefined, t)).toBe("Line 3 · 10:00:00");
  });
});
