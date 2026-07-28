import { afterEach, describe, expect, it, vi } from "vitest";
import { en } from "../src/i18n/en";
import { createTranslator, detectLocale, persistLocale } from "../src/i18n/i18n";

const originalLanguage = navigator.language;

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, "language", {
    configurable: true,
    value: originalLanguage,
  });
});

describe("i18n", () => {
  it("prefers a supported persisted locale", () => {
    localStorage.setItem("unquote-locale", "zh-CN");
    Object.defineProperty(navigator, "language", { configurable: true, value: "en-US" });

    expect(detectLocale()).toBe("zh-CN");
  });

  it("falls back to the browser language for unsupported persisted values", () => {
    localStorage.setItem("unquote-locale", "fr");
    Object.defineProperty(navigator, "language", { configurable: true, value: "zh-Hans" });

    expect(detectLocale()).toBe("zh-CN");
  });

  it("falls back safely when locale storage cannot be read", () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("unavailable");
    });
    Object.defineProperty(navigator, "language", { configurable: true, value: "en-GB" });

    expect(detectLocale()).toBe("en");
  });

  it("ignores locale persistence failures", () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("unavailable");
    });

    expect(() => persistLocale("en")).not.toThrow();
  });

  it("translates messages with and without interpolation values", () => {
    const t = createTranslator(en);

    expect(t("input.title")).toBe("Source");
    expect(t("error.location", { line: 2, column: 4 })).toBe("Line 2, column 4");
  });

  it("exposes translation without reaching the React app barrel", async () => {
    const entry = await import("../src/i18n");

    expect(Object.keys(entry).sort()).toEqual([
      "createTranslator",
      "detectLocale",
      "en",
      "persistLocale",
      "zhCN",
    ]);
    expect(entry.createTranslator(entry.en)("extension.openInUnquote")).toBe(
      en["extension.openInUnquote"],
    );
  });
});
