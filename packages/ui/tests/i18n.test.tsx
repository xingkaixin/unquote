import { afterEach, describe, expect, it, vi } from "vitest";
import { en } from "../src/i18n/en";
import { createTranslator, detectLocale, persistLocale } from "../src/i18n/i18n";
import { zhCN } from "../src/i18n/zh-CN";

const originalLanguage = navigator.language;

const trajectoryMessageKeys = [
  "app.tab.trajectory",
  "trajectory.title",
  "trajectory.summary",
  "trajectory.overview",
  "trajectory.ledger",
  "trajectory.detail",
  "trajectory.detailEmpty",
  "trajectory.unassigned",
  "trajectory.empty",
  "trajectory.metric.turns",
  "trajectory.metric.events",
  "trajectory.metric.tools",
  "trajectory.metric.failures",
  "trajectory.metric.tokens",
  "trajectory.metric.duration",
  "trajectory.token.input",
  "trajectory.token.output",
  "trajectory.token.cacheRead",
  "trajectory.token.cacheWrite",
  "trajectory.token.reasoning",
  "trajectory.lane.activity",
  "trajectory.lane.model",
  "trajectory.lane.tool",
  "trajectory.zoomIn",
  "trajectory.zoomOut",
  "trajectory.reset",
  "trajectory.rangeStart",
  "trajectory.rangeEnd",
  "trajectory.noTimeline",
  "trajectory.search",
  "trajectory.searchPlaceholder",
  "trajectory.kind",
  "trajectory.clearFilters",
  "trajectory.visibleCount",
  "trajectory.kind.all",
  "trajectory.kind.user",
  "trajectory.kind.system",
  "trajectory.kind.assistant",
  "trajectory.kind.reasoning",
  "trajectory.kind.tool",
  "trajectory.kind.subagent",
  "trajectory.kind.compaction",
  "trajectory.status.completed",
  "trajectory.status.running",
  "trajectory.status.failed",
  "trajectory.status.aborted",
  "trajectory.derivedStep",
  "trajectory.derivedStepHint",
  "trajectory.line",
  "trajectory.turn",
  "trajectory.turnUnindexed",
  "trajectory.itemCount",
  "trajectory.time",
  "trajectory.duration",
  "trajectory.startedAt",
  "trajectory.endedAt",
  "trajectory.callId",
  "trajectory.warnings",
  "trajectory.openRecord",
  "trajectory.openCall",
  "trajectory.openResult",
  "trajectory.openCompletion",
  "trajectory.warning.missingTimestamp",
  "trajectory.warning.missingTurnStart",
  "trajectory.warning.reversedTimestamp",
  "trajectory.warning.unpairedCall",
  "trajectory.warning.unpairedResult",
  "trajectory.warning.unpairedCompletion",
  "trajectory.warning.duplicateCall",
  "trajectory.warning.duplicateResult",
  "trajectory.warning.duplicateCompletion",
  "trajectory.warning.openTurn",
  "trajectory.warning.unattachedTokens",
] as const;

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

    expect(t("input.modeLabel")).toBe("Input format");
    expect(t("error.location", { line: 2, column: 4 })).toBe("Line 2, column 4");
  });

  it("locks every trajectory message in both locale catalogs", () => {
    expect(trajectoryMessageKeys).toHaveLength(73);

    for (const key of trajectoryMessageKeys) {
      expect(en).toHaveProperty(key);
      expect(zhCN).toHaveProperty(key);
      expect(en[key]).not.toBe("");
      expect(zhCN[key]).not.toBe("");
    }

    expect(
      Object.keys(en)
        .filter((key) => key === "app.tab.trajectory" || key.startsWith("trajectory."))
        .sort(),
    ).toEqual([...trajectoryMessageKeys].sort());
    expect(
      Object.keys(zhCN)
        .filter((key) => key === "app.tab.trajectory" || key.startsWith("trajectory."))
        .sort(),
    ).toEqual([...trajectoryMessageKeys].sort());
  });

  it("renders derived trajectory facts, identifiers, and statuses in both languages", () => {
    const english = createTranslator(en);
    const chinese = createTranslator(zhCN);

    expect(english("trajectory.derivedStep", { step: 7 })).toBe("≈ derived step 7");
    expect(chinese("trajectory.derivedStep", { step: 7 })).toBe("约为派生步骤 7");
    expect(english("trajectory.line", { line: 42 })).toBe("Line 42");
    expect(chinese("trajectory.line", { line: 42 })).toBe("第 42 行");
    expect(english("trajectory.turn", { turn: 4 })).toBe("Turn 4");
    expect(chinese("trajectory.turn", { turn: 4 })).toBe("第 4 轮");
    expect(english("trajectory.visibleCount", { visible: 3, total: 8 })).toBe("3 of 8 visible");
    expect(chinese("trajectory.visibleCount", { visible: 3, total: 8 })).toBe("显示 3/8 项");
    expect(english("trajectory.openResult")).toBe("Open result Record");
    expect(chinese("trajectory.openResult")).toBe("打开结果 Record");
    expect(english("trajectory.status.running")).toBe("Running");
    expect(english("trajectory.kind.system")).toBe("System");
    expect(chinese("trajectory.kind.system")).toBe("系统");
    expect(chinese("trajectory.status.failed")).toBe("失败");
    expect(english("trajectory.warning.missingTimestamp")).toBe("Missing timestamp");
    expect(chinese("trajectory.warning.missingTimestamp")).toBe("缺少时间戳");
    expect(english("trajectory.derivedStep", { step: 7 })).not.toBe(
      chinese("trajectory.derivedStep", { step: 7 }),
    );
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
