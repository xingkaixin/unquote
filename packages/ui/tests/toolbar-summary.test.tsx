import { describe, expect, it } from "vitest";
import {
  filterLabel,
  progressLabel,
  toolbarSummary,
  type ParseProgress,
  type ToolbarSummaryInput,
} from "../src/lib/toolbar-summary";
import { createTranslator } from "../src/i18n/i18n";
import { en } from "../src/i18n/en";
import { zhCN } from "../src/i18n/zh-CN";

const t = createTranslator(en);
const zhT = createTranslator(zhCN);

const doneProgress: ParseProgress = { done: true, elapsedMs: 12 };
const pendingProgress: ParseProgress = { done: false, elapsedMs: 45.6 };
const stats = { total: 3, success: 2, failed: 1 };
const visibleStats = { total: 3, success: 2, failed: 1 };

const baseInput: ToolbarSummaryInput = {
  progress: doneProgress,
  stats,
  visibleStats,
  recordFilter: "all",
  searchQuery: "",
  searchStatus: "idle",
  searchErrorKind: null,
  pathError: null,
  matchCount: 0,
};

describe("filterLabel", () => {
  it("translates each record filter to its localized label", () => {
    expect(filterLabel("all", t)).toBe("All");
    expect(filterLabel("matches", t)).toBe("Matches");
    expect(filterLabel("errors", t)).toBe("Errors");
    expect(filterLabel("nested", t)).toBe("Nested");
    expect(filterLabel("tool", t)).toBe("Tools");
    expect(filterLabel("message", t)).toBe("Messages");
    expect(filterLabel("events", t)).toBe("Events");
  });
});

describe("progressLabel", () => {
  it("shows plain stats once parsing is done", () => {
    expect(progressLabel(doneProgress, "all", stats, visibleStats, t)).toBe(
      "3 total · 2 ok · 1 err",
    );
  });

  it("appends rounded elapsed time and parsed record count while parsing", () => {
    expect(progressLabel(pendingProgress, "all", stats, visibleStats, t)).toBe(
      "3 total · 2 ok · 1 err · 3 lines · 46 ms",
    );
  });

  it("uses the filtered stats label when a filter narrows the visible set", () => {
    expect(
      progressLabel(doneProgress, "matches", stats, { total: 1, success: 1, failed: 0 }, t),
    ).toBe("1/3 shown · 1 ok · 0 err");
  });
});

describe("toolbarSummary", () => {
  it("prefers a path error over everything else", () => {
    expect(toolbarSummary({ ...baseInput, pathError: "Invalid path" }, t)).toBe("Invalid path");
  });

  it("shows a timeout label when the search worker times out", () => {
    expect(
      toolbarSummary(
        { ...baseInput, searchQuery: "boom", searchStatus: "error", searchErrorKind: "timeout" },
        t,
      ),
    ).toBe("Search timed out");
  });

  it("reports worker failures for path queries without a text search", () => {
    expect(
      toolbarSummary({ ...baseInput, searchStatus: "error", searchErrorKind: "timeout" }, t),
    ).toBe("Search timed out");
  });

  it("shows a generic failure label for non-timeout search errors", () => {
    expect(
      toolbarSummary(
        {
          ...baseInput,
          searchQuery: "boom",
          searchStatus: "error",
          searchErrorKind: "worker-error",
        },
        t,
      ),
    ).toBe("Search failed");
  });

  it("explains in both locales when regex requires a background worker", () => {
    const input: ToolbarSummaryInput = {
      ...baseInput,
      searchQuery: "^(a+)+$",
      searchStatus: "error",
      searchErrorKind: "regex-without-worker",
    };

    expect(toolbarSummary(input, t)).toBe("Regex search requires a background worker");
    expect(toolbarSummary(input, zhT)).toBe("正则搜索需要后台 Worker");
  });

  it("falls back to the plain progress label with no search or filter active", () => {
    expect(toolbarSummary(baseInput, t)).toBe("3 total · 2 ok · 1 err");
  });

  it("combines filter label, visible/total counts, and match count while searching", () => {
    expect(
      toolbarSummary(
        { ...baseInput, searchQuery: "boom", searchStatus: "complete", matchCount: 2 },
        t,
      ),
    ).toBe("All · 3/3 · 2 Matches");
  });

  it("combines filter label with the progress label when only a filter is active", () => {
    expect(
      toolbarSummary(
        {
          ...baseInput,
          recordFilter: "errors",
          visibleStats: { total: 1, success: 0, failed: 1 },
        },
        t,
      ),
    ).toBe("Errors · 1/3 · 1/3 shown · 0 ok · 1 err");
  });
});
