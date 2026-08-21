import type { ParseStats } from "@unquote/core";
import type { createTranslator } from "../i18n/i18n";
import type { ParserProgress } from "./parse-text";
import type { QueryInteractionState } from "./query-interaction";
import type { SearchErrorKind, SearchStatus } from "./search-lifecycle";

type Translator = ReturnType<typeof createTranslator>;
type RecordFilter = QueryInteractionState["recordFilter"];

export type ParseProgress = Pick<ParserProgress, "done" | "processedLines" | "elapsedMs">;

export const filterLabel = (filter: RecordFilter, t: Translator): string => {
  switch (filter) {
    case "matches":
      return t("filter.matches");
    case "errors":
      return t("filter.errors");
    case "nested":
      return t("filter.nested");
    case "tool":
      return t("filter.tools");
    case "message":
      return t("filter.messages");
    case "events":
      return t("filter.events");
    case "all":
      return t("filter.all");
  }
};

const statsLabel = (
  recordFilter: RecordFilter,
  stats: ParseStats,
  visibleStats: ParseStats,
  t: Translator,
): string =>
  recordFilter === "all"
    ? t("stats.label", { total: stats.total, success: stats.success, failed: stats.failed })
    : t("stats.filteredLabel", {
        shown: visibleStats.total,
        total: stats.total,
        success: visibleStats.success,
        failed: visibleStats.failed,
      });

export const progressLabel = (
  progress: ParseProgress,
  recordFilter: RecordFilter,
  stats: ParseStats,
  visibleStats: ParseStats,
  t: Translator,
): string => {
  const summary = statsLabel(recordFilter, stats, visibleStats, t);
  return progress.done
    ? summary
    : `${summary} · ${t("stats.progress", {
        processed: progress.processedLines,
        elapsed: Math.round(progress.elapsedMs),
      })}`;
};

export interface ToolbarSummaryInput {
  progress: ParseProgress;
  stats: ParseStats;
  visibleStats: ParseStats;
  recordFilter: RecordFilter;
  searchQuery: string;
  searchStatus: SearchStatus;
  searchErrorKind: SearchErrorKind | null;
  pathError: string | null;
  matchCount: number;
}

export const toolbarSummary = (input: ToolbarSummaryInput, t: Translator): string => {
  const {
    progress,
    stats,
    visibleStats,
    recordFilter,
    searchQuery,
    searchStatus,
    searchErrorKind,
    pathError,
    matchCount,
  } = input;

  if (pathError) {
    return pathError;
  }

  const searchErrorMessageKey = {
    timeout: "search.timeout",
    "too-large": "search.tooLargeWithoutWorker",
    "worker-error": "search.failed",
    "regex-without-worker": "search.regexRequiresWorker",
  } as const;
  const searchErrorLabel =
    searchQuery && searchStatus === "error"
      ? t(searchErrorMessageKey[searchErrorKind ?? "worker-error"])
      : null;
  if (searchErrorLabel) {
    return searchErrorLabel;
  }

  if (!searchQuery && recordFilter === "all") {
    return progressLabel(progress, recordFilter, stats, visibleStats, t);
  }

  const matchesText = searchQuery
    ? `${matchCount} ${t("filter.matches")}`
    : progressLabel(progress, recordFilter, stats, visibleStats, t);
  return `${filterLabel(recordFilter, t)} · ${visibleStats.total}/${stats.total} · ${matchesText}`;
};
