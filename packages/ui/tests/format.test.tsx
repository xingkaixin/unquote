import { describe, expect, it } from "vitest";
import type { Locale } from "../src/i18n/i18n";
import { formatClockTime } from "../src/lib/format";

const timestamp = Date.UTC(2026, 5, 6, 13, 44, 6);

const expectedClockTime = (locale: Locale) =>
  new Intl.DateTimeFormat(locale, { timeStyle: "medium" }).format(timestamp);

describe("formatClockTime", () => {
  it("formats a numeric timestamp with the application locale", () => {
    expect(formatClockTime(timestamp, "en")).toBe(expectedClockTime("en"));
    expect(formatClockTime(timestamp, "zh-CN")).toBe(expectedClockTime("zh-CN"));
    expect(formatClockTime(timestamp, "ja")).toBe(expectedClockTime("ja"));
  });

  it("parses an ISO string into the same clock time", () => {
    expect(formatClockTime("2026-06-06T13:44:06.000Z", "en")).toBe(expectedClockTime("en"));
  });

  it("keeps an unparseable string as a safe fallback", () => {
    expect(formatClockTime("not-a-date", "en")).toBe("not-a-date");
  });

  it("renders nothing when there is no timestamp", () => {
    expect(formatClockTime(undefined, "en")).toBe("");
  });
});
