import { materializeNode } from "@unquote/core";
import type { JsonlRecord } from "@unquote/core";
import { Chrome, PanelLeftOpen } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CommandPalette } from "./components/command-palette";
import { FileOverview } from "./components/file-overview";
import { InputPane } from "./components/input-pane";
import type { SourceParseError } from "./components/input-pane";
import { LocaleToggle } from "./components/locale-toggle";
import { PathInspector } from "./components/path-inspector";
import type { PathInspectorSelection } from "./components/path-inspector";
import { RecordList } from "./components/record-list";
import { StatusFooter } from "./components/status-footer";
import { ThemeToggle } from "./components/theme-toggle";
import { TocPane } from "./components/toc-pane";
import { Toolbar } from "./components/toolbar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/tabs";
import { useTranslation } from "./i18n/context";
import { useLocalFileSource } from "./hooks/use-local-file-source";
import { useParser } from "./hooks/use-parser";
import { useQueryInteraction } from "./hooks/use-query-interaction";
import { createFileOverviewState, updateFileOverview } from "./lib/file-overview";
import type { FileOverviewState } from "./lib/file-overview";
import {
  readFileText,
  readJsonlRecordsByLine,
} from "./lib/local-file-source";
import { markPerf, measurePerfFn } from "./lib/perf";
import { createRecordInsightMapState, updateRecordInsightMap } from "./lib/record-insight";
import type { RecordInsightMapState } from "./lib/record-insight";
import {
  collectStringifiedPaths,
  filterRecords,
  getRenderedRecord,
  hasJsonlRecords,
  materializeRecord,
  resolveTreePath,
  searchRecords,
} from "./lib/tree";
import { sourceSamples } from "./lib/source-samples";
import type {
  ResolvedTreePath,
  SearchOptions,
  TreeRow,
} from "./lib/tree";

const largeSourceCollapseBytes = 1_000_000;

interface PathScrollTarget {
  recordId: string;
  pathText: string;
  requestId: number;
}

const formatFileSize = (bytes: number) => {
  const units = ["B", "KB", "MB", "GB"] as const;
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const formatted = unitIndex === 0 || value >= 10 ? String(Math.round(value)) : value.toFixed(1);
  return `${formatted} ${units[unitIndex]}`;
};

const createSelectionFromTarget = (target: ResolvedTreePath): PathInspectorSelection => ({
  recordId: target.recordId,
  recordLine: target.recordLine,
  pathText: target.pathText,
  jsonPath: target.jsonPath,
  jqPath: target.jqPath,
  rawKey: target.rawKey,
  kind: target.kind,
  sourceState: target.sourceState,
});

const createSelectionFromRow = (record: JsonlRecord, row: TreeRow): PathInspectorSelection => ({
  recordId: record.id,
  recordLine: record.lineNumber,
  pathText: row.pathText,
  jsonPath: row.jsonPath,
  jqPath: row.jqPath,
  rawKey: row.keyLabel,
  kind: row.kind,
  sourceState: row.sourceState,
});

const getRecordStats = (records: JsonlRecord[]) => {
  const success = records.filter((record) => record.node || record.deferred).length;
  return {
    total: records.length,
    success,
    failed: records.length - success,
  };
};

const formatParseMode = (format: "json" | "jsonl") => format.toUpperCase();

const getCopyValue = (record: JsonlRecord, restoredRecordIds: Set<string>) => {
  if (record.node) {
    return materializeRecord(record, restoredRecordIds);
  }

  return {
    lineNumber: record.lineNumber,
    error: record.error ?? "Parse error",
    ...(record.errorMeta
      ? {
          line: record.errorMeta.line,
          column: record.errorMeta.column,
          rawLine: record.rawLine ?? record.errorMeta.rawLine,
          context: record.errorMeta.context,
        }
      : {}),
    summary: record.summary,
  };
};

const formatRecordsAsJsonl = (records: JsonlRecord[], restoredRecordIds: Set<string>) =>
  records.map((record) => JSON.stringify(getCopyValue(record, restoredRecordIds))).join("\n");

const formatRecordsAsJson = (
  records: JsonlRecord[],
  restoredRecordIds: Set<string>,
  format: "json" | "jsonl",
) => {
  const values = records.map((record) => getCopyValue(record, restoredRecordIds));
  if (format === "json") {
    return JSON.stringify(values[0] ?? null, null, 2);
  }

  return JSON.stringify(values, null, 2);
};

const isPathInsideFocus = (pathText: string, focusedPath: string) =>
  pathText === focusedPath ||
  pathText.startsWith(`${focusedPath}.`) ||
  pathText.startsWith(`${focusedPath}[`);

const downloadText = (contents: string, filename: string, type: string) => {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

const createExportFilename = (extension: "json" | "jsonl") => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `unquote-visible-${timestamp}.${extension}`;
};

export interface UnquoteAppProps {
  initialInput?: string;
  chromeWebStoreUrl?: string;
  onSourceChange?: (value: string) => void;
  onOpenFile?: () => Promise<File | string | null> | File | string | null | void;
  onReadFile?: (file: File) => Promise<string>;
}

export const UnquoteApp = ({
  initialInput = "",
  chromeWebStoreUrl,
  onSourceChange,
  onOpenFile,
  onReadFile,
}: UnquoteAppProps) => {
  const { t } = useTranslation();
  const [sourceText, setSourceText] = useState(initialInput);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [readingFile, setReadingFile] = useState<File | null>(null);
  const [importedFile, setImportedFile] = useState<File | null>(null);
  const [readProgress, setReadProgress] = useState<number | null>(null);
  const [mode, setMode] = useState<"auto" | "json" | "jsonl">("auto");
  const [hoveredPath, setHoveredPath] = useState("$");
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [expandedStringifiedPaths, setExpandedStringifiedPaths] = useState<Set<string>>(new Set());
  const [restoredRecordIds, setRestoredRecordIds] = useState<Set<string>>(new Set());
  const [sourceCollapsed, setSourceCollapsed] = useState(false);
  const [theme, setTheme] = useState<"system" | "light" | "dark">(() => {
    try {
      return (localStorage.getItem("unquote-theme") as "system" | "light" | "dark") ?? "system";
    } catch {
      return "system";
    }
  });
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [selectedPath, setSelectedPath] = useState<PathInspectorSelection | null>(null);
  const [focusedPath, setFocusedPath] = useState<{ recordId: string; pathText: string } | null>(
    null,
  );
  const [scrollTarget, setScrollTarget] = useState<PathScrollTarget | null>(null);
  const [recordScrollTarget, setRecordScrollTarget] = useState<{
    recordId: string;
    requestId: number;
  } | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const overviewStateRef = useRef<FileOverviewState>(createFileOverviewState());
  const recordInsightStateRef = useRef<RecordInsightMapState>(createRecordInsightMapState());
  const fileImportIdRef = useRef(0);
  const scrollRequestIdRef = useRef(0);
  const { result, progress, recordsVersion } = useParser(
    sourceText,
    mode === "auto" ? undefined : mode,
    sourceFile,
  );

  // Match-pipeline data is written into these refs during render so the
  // interaction hook (called above the pipeline) can read the latest values.
  const visibleRecordsRef = useRef<JsonlRecord[]>([]);
  const matchCountRef = useRef(0);
  const visibleMatchesRef = useRef<
    { recordId: string; pathText: string; stringifiedPathChain: string[] }[] | null
  >(null);

  const qi = useQueryInteraction({
    allRecords: result.records,
    translateError: (reason) =>
      t(reason === "invalid" ? "path.invalid" : "path.notFound"),
    visibleRecordsRef,
    matchCountRef,
    visibleMatchesRef,
  });
  const {
    searchQuery,
    searchRegex,
    searchCaseSensitive,
    searchJq,
    recordFilter,
    toolbarQuery,
    commandInput,
    pathError,
    pathMatches,
    currentPathMatchIndex,
    currentMatchIndex,
  } = qi.state;

  const detectedFormat = mode === "auto" ? result.format : mode;
  const parseModeLabel =
    mode === "auto" && result.stats.failed > 0 && result.stats.total > 0
      ? t("stats.autoFailureMode", { format: formatParseMode(result.format) })
      : undefined;
  const sourceParseError = useMemo<SourceParseError | null>(() => {
    const record = result.records[0];
    if (result.format !== "json" || result.stats.failed !== 1 || !record?.errorMeta) {
      return null;
    }

    return {
      message: record.error ?? t("error.parseFailed"),
      line: record.errorMeta.line,
      column: record.errorMeta.column,
      context: record.errorMeta.context,
      format: formatParseMode(result.format),
    };
  }, [result, t]);
  const sampleOptions = useMemo(
    () => [
      {
        id: "escaped-api-response",
        label: t("samples.escapedApiResponse"),
        value: sourceSamples.escapedApiResponse.source,
        expandedPaths: sourceSamples.escapedApiResponse.expandedPaths,
      },
      {
        id: "agent-tool-call-jsonl",
        label: t("samples.agentToolCallJsonl"),
        value: sourceSamples.agentToolCallJsonl.source,
        expandedPaths: sourceSamples.agentToolCallJsonl.expandedPaths,
      },
      {
        id: "mixed-valid-invalid-jsonl",
        label: t("samples.mixedValidInvalidJsonl"),
        value: sourceSamples.mixedValidInvalidJsonl.source,
        expandedPaths: sourceSamples.mixedValidInvalidJsonl.expandedPaths,
      },
    ],
    [t],
  );

  const searchOptions = useMemo<SearchOptions>(
    () => ({
      regex: searchRegex,
      caseSensitive: searchCaseSensitive,
      jq: searchJq,
    }),
    [searchCaseSensitive, searchJq, searchRegex],
  );

  const localFileSource = useLocalFileSource(sourceFile, searchQuery, searchOptions);

  const inMemoryMatches = useMemo(() => {
    if (!searchQuery || sourceFile) return null;
    return measurePerfFn("search:memory", () =>
      searchRecords(result.records, searchQuery, searchOptions),
    );
  }, [recordsVersion, result.records, searchOptions, searchQuery, sourceFile]);

  const matches = sourceFile && searchQuery ? localFileSource.fileMatches : inMemoryMatches;

  const recordInsights = useMemo(
    () => updateRecordInsightMap(result.records, recordInsightStateRef.current),
    [recordsVersion, result.records],
  );
  const visibleRecords = useMemo(
    () => filterRecords(result.records, recordFilter, matches, recordInsights),
    [matches, recordFilter, recordInsights, recordsVersion, result.records],
  );
  const visibleStats = useMemo(
    () => (recordFilter === "all" ? result.stats : getRecordStats(visibleRecords)),
    [recordFilter, recordsVersion, result.stats, visibleRecords],
  );
  const fileOverview = useMemo(
    () => updateFileOverview(result.records, overviewStateRef.current),
    [recordsVersion, result.records],
  );
  const visibleMatches = useMemo(() => {
    if (!matches) return null;

    const visibleRecordIds = new Set(visibleRecords.map((record) => record.id));
    return matches.filter((match) => visibleRecordIds.has(match.recordId));
  }, [matches, recordsVersion, visibleRecords]);
  const matchCount = visibleMatches?.length ?? 0;

  // Feed the computed match pipeline back to the interaction hook's refs so its
  // callbacks/effects read the latest values next render.
  visibleRecordsRef.current = visibleRecords;
  matchCountRef.current = matchCount;
  visibleMatchesRef.current = visibleMatches;

  // Clear any pending scroll target when the filter or search options change
  // (match-index reset lives in the interaction hook).
  useEffect(() => {
    setScrollTarget(null);
  }, [recordFilter, searchQuery, searchRegex, searchCaseSensitive, searchJq]);

  useEffect(() => {
    if (!visibleMatches || visibleMatches.length === 0) return;

    const pathsToExpand = new Set<string>();
    for (const match of visibleMatches) {
      for (const path of match.stringifiedPathChain) {
        pathsToExpand.add(path);
      }
    }

    setExpandedStringifiedPaths((current) => {
      const next = new Set(current);
      for (const path of pathsToExpand) {
        next.add(path);
      }
      return next;
    });
  }, [visibleMatches]);

  const activeMatch = useMemo(() => {
    if (!visibleMatches || visibleMatches.length === 0) return null;
    const match = visibleMatches[currentMatchIndex] ?? visibleMatches[0]!;
    return {
      recordId: match.recordId,
      pathText: match.pathText,
    };
  }, [visibleMatches, currentMatchIndex]);

  useEffect(() => {
    if (
      !focusedPath ||
      !activeMatch ||
      (focusedPath.recordId === activeMatch.recordId &&
        isPathInsideFocus(activeMatch.pathText, focusedPath.pathText))
    ) {
      return;
    }

    setFocusedPath(null);
  }, [activeMatch, focusedPath]);

  const scrollToPath = (recordId: string, pathText: string) => {
    setFocusedPath((current) =>
      current && (current.recordId !== recordId || !isPathInsideFocus(pathText, current.pathText))
        ? null
        : current,
    );
    scrollRequestIdRef.current += 1;
    setScrollTarget({ recordId, pathText, requestId: scrollRequestIdRef.current });
  };

  const scrollToSearchMatch = (index: number) => {
    const match = visibleMatches?.[index];
    if (!match) {
      return;
    }

    setFocusedPath((current) =>
      current && (current.recordId !== match.recordId || !isPathInsideFocus(match.pathText, current.pathText))
        ? null
        : current,
    );
    scrollRequestIdRef.current += 1;
    setScrollTarget({
      recordId: match.recordId,
      pathText: match.pathText,
      requestId: scrollRequestIdRef.current,
    });
  };

  // React to interaction-driven navigation: a path jump selects/expands the
  // target node and scrolls to it; a search re-navigation scrolls to the match.
  useEffect(() => {
    const target = qi.navigationTarget;
    if (!target) {
      return;
    }

    if (target.kind === "path") {
      setSelectedPath(
        createSelectionFromTarget({
          recordId: target.recordId,
          pathText: target.pathText,
          stringifiedPathChain: target.stringifiedPathChain,
        } as ResolvedTreePath),
      );
      setActiveRecordId(target.recordId);
      setRestoredRecordIds((current) => {
        const next = new Set(current);
        next.delete(target.recordId);
        return next;
      });
      setExpandedStringifiedPaths((current) => {
        const next = new Set(current);
        for (const path of target.stringifiedPathChain) {
          next.add(path);
        }
        return next;
      });
      scrollToPath(target.recordId, target.pathText);
    } else {
      scrollToSearchMatch(target.matchIndex);
    }
    // navigationTarget carries a version token that changes on every navigating
    // action, so re-submitting the same query re-scrolls.
  }, [qi.navigationTarget]);

  const handleOpenCommandPalette = useCallback(() => {
    qi.seedCommandInput();
    setCommandPaletteOpen(true);
  }, [qi]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        handleOpenCommandPalette();
      }
      if (event.key === "Escape") {
        setCommandPaletteOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleOpenCommandPalette]);

  useEffect(() => {
    onSourceChange?.(sourceText);
  }, [onSourceChange, sourceText]);

  useEffect(() => {
    const visibleRecordIds = new Set(visibleRecords.map((record) => record.id));
    const firstRecord = visibleRecords[0];
    setActiveRecordId((current) =>
      current && visibleRecordIds.has(current) ? current : (firstRecord?.id ?? null),
    );
  }, [recordsVersion, visibleRecords]);

  useEffect(() => {
    const visibleRecordIds = new Set(visibleRecords.map((record) => record.id));
    if (selectedPath && !visibleRecordIds.has(selectedPath.recordId)) {
      setSelectedPath(null);
    }
    if (selectedRecordId && !visibleRecordIds.has(selectedRecordId)) {
      setSelectedRecordId(null);
    }
    if (focusedPath && !visibleRecordIds.has(focusedPath.recordId)) {
      setFocusedPath(null);
    }
    if (scrollTarget && !visibleRecordIds.has(scrollTarget.recordId)) {
      setScrollTarget(null);
    }
    if (recordScrollTarget && !visibleRecordIds.has(recordScrollTarget.recordId)) {
      setRecordScrollTarget(null);
    }
  }, [
    focusedPath,
    recordScrollTarget,
    recordsVersion,
    scrollTarget,
    selectedPath,
    selectedRecordId,
    visibleRecords,
  ]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else if (theme === "light") {
      root.classList.remove("dark");
    } else {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const apply = (e: MediaQueryListEvent | MediaQueryList) => {
        root.classList.toggle("dark", e.matches);
      };
      apply(mq);
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
    localStorage.setItem("unquote-theme", theme);
  }, [theme]);

  const handleSourceChange = (value: string) => {
    fileImportIdRef.current += 1;
    setReadingFile(null);
    setImportedFile(null);
    setReadProgress(null);
    setSourceFile(null);
    setSourceText(value);
    setRestoredRecordIds(new Set());
    setExpandedStringifiedPaths(new Set());
    setSelectedPath(null);
    setSelectedRecordId(null);
    setFocusedPath(null);
    setScrollTarget(null);
    setRecordScrollTarget(null);
    qi.reset();
    if (value.length > largeSourceCollapseBytes) {
      setSourceCollapsed(true);
    }
  };

  const handleSampleSelect = (sample: { value: string; expandedPaths: readonly string[] }) => {
    setMode("auto");
    handleSourceChange(sample.value);
    setExpandedStringifiedPaths(new Set(sample.expandedPaths));
  };

  const handleFileDrop = async (file: File) => {
    const requestId = fileImportIdRef.current + 1;
    fileImportIdRef.current = requestId;
    setReadingFile(file);
    setImportedFile(null);
    setReadProgress(onReadFile ? null : 0);
    setSourceFile(null);

    const streamAsJsonl =
      file.size > largeSourceCollapseBytes &&
      (mode === "jsonl" || (mode === "auto" && file.name.toLowerCase().endsWith(".jsonl")));

    if (streamAsJsonl) {
      setReadingFile(null);
      setImportedFile(null);
      setReadProgress(null);
      setSourceFile(file);
      setSourceText("");
      setRestoredRecordIds(new Set());
      setExpandedStringifiedPaths(new Set());
      setSelectedPath(null);
      setSelectedRecordId(null);
      setFocusedPath(null);
      setScrollTarget(null);
      setRecordScrollTarget(null);
      qi.reset();
      setSourceCollapsed(true);
      return;
    }

    let text: string;
    try {
      text = onReadFile
        ? await onReadFile(file)
        : await readFileText(file, (nextProgress) => {
            if (fileImportIdRef.current === requestId) {
              setReadProgress(nextProgress);
            }
          });
    } catch (error) {
      if (fileImportIdRef.current === requestId) {
        setReadingFile(null);
        setReadProgress(null);
      }
      throw error;
    }

    if (fileImportIdRef.current !== requestId) {
      return;
    }

    setReadingFile(null);
    setReadProgress(null);
    handleSourceChange(text);
    setImportedFile(file);
  };

  const handleOpenFile = async () => {
    const source = await onOpenFile?.();
    if (source instanceof File) {
      await handleFileDrop(source);
      return;
    }

    if (typeof source === "string") {
      handleSourceChange(source);
    }
  };

  const handleCopyJsonl = async () => {
    const records = await localFileSource.getFullRecords(visibleRecords);
    await navigator.clipboard.writeText(formatRecordsAsJsonl(records, restoredRecordIds));
  };

  const handleCopyFormattedJson = async () => {
    const records = await localFileSource.getFullRecords(visibleRecords);
    await navigator.clipboard.writeText(
      formatRecordsAsJson(records, restoredRecordIds, result.format),
    );
  };

  const handleExportJsonl = async () => {
    const records = await localFileSource.getFullRecords(visibleRecords);
    downloadText(
      formatRecordsAsJsonl(records, restoredRecordIds),
      createExportFilename("jsonl"),
      "application/jsonl;charset=utf-8",
    );
  };

  const handleExportFormattedJson = async () => {
    const records = await localFileSource.getFullRecords(visibleRecords);
    downloadText(
      formatRecordsAsJson(records, restoredRecordIds, result.format),
      createExportFilename("json"),
      "application/json;charset=utf-8",
    );
  };

  const handleExpandAll = () => {
    const all = measurePerfFn("expand:all:collect", () => {
      const paths = new Set<string>();
      visibleRecords.forEach((record) => {
        collectStringifiedPaths(record, expandedStringifiedPaths, restoredRecordIds).forEach(
          (path) => {
            paths.add(path);
          },
        );
      });
      return paths;
    });
    setRestoredRecordIds(new Set());
    setExpandedStringifiedPaths(all);
    markPerf("expand:all:set-state");
  };

  const handleRestoreAll = () => {
    setExpandedStringifiedPaths(new Set());
    setRestoredRecordIds(
      new Set(
        result.records
          .filter((record) => record.node || record.deferred)
          .map((record) => record.id),
      ),
    );
    setSelectedPath(null);
    setFocusedPath(null);
    setScrollTarget(null);
    qi.clearPathMatches();
  };

  const handleTogglePath = (path: string) => {
    markPerf("expand:path");
    setExpandedStringifiedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleCopyRecord = async (record: JsonlRecord) => {
    const [copyRecord = record] = await localFileSource.getFullRecords([record]);
    const value = getCopyValue(copyRecord, restoredRecordIds);
    await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
  };

  const handleCopyRawLine = async (record: JsonlRecord) => {
    if (sourceFile) {
      const fullRecords = await readJsonlRecordsByLine(sourceFile, new Set([record.lineNumber]));
      const fullRecord = fullRecords.get(record.lineNumber);
      if (fullRecord?.node) {
        await navigator.clipboard.writeText(JSON.stringify(getCopyValue(fullRecord, new Set())));
        return;
      }
      if (fullRecord?.rawLine) {
        await navigator.clipboard.writeText(fullRecord.rawLine);
        return;
      }
    }

    await navigator.clipboard.writeText(
      record.rawLine ?? record.errorMeta?.rawLine ?? record.summary,
    );
  };

  const handleCopyRecordError = async (record: JsonlRecord) => {
    const message = record.error ?? t("error.parseFailed");
    const errorMeta = record.errorMeta;
    const details = errorMeta
      ? [
          t("error.message", { message }),
          t("error.location", { line: errorMeta.line, column: errorMeta.column }),
          `${t("error.rawLine")}:\n${errorMeta.rawLine}`,
          `${t("error.context")}:\n${errorMeta.context}`,
        ].join("\n")
      : t("error.message", { message });

    await navigator.clipboard.writeText(details);
  };

  const handleCopyNode = async (recordId: string, row: TreeRow) => {
    const record = result.records.find((candidate) => candidate.id === recordId);
    const [copyRecord] = record ? await localFileSource.getFullRecords([record]) : [];
    const renderedRecord = copyRecord ? getRenderedRecord(copyRecord, restoredRecordIds) : null;
    const resolved = renderedRecord?.node ? resolveTreePath([renderedRecord], row.pathText) : null;
    const value = materializeNode(resolved?.ok ? resolved.target.node : row.node);
    await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
  };

  const getSelectedNodeContext = async () => {
    if (!selectedPath) {
      return null;
    }

    const record = result.records.find((candidate) => candidate.id === selectedPath.recordId);
    const [copyRecord] = record ? await localFileSource.getFullRecords([record]) : [];
    const renderedRecord = copyRecord ? getRenderedRecord(copyRecord, restoredRecordIds) : null;
    const resolved = renderedRecord?.node
      ? resolveTreePath([renderedRecord], selectedPath.pathText)
      : null;

    return copyRecord && resolved?.ok ? { record: copyRecord, target: resolved.target } : null;
  };

  const handleFocusSelectedNode = () => {
    if (!selectedPath) {
      return;
    }

    setFocusedPath({ recordId: selectedPath.recordId, pathText: selectedPath.pathText });
    setActiveRecordId(selectedPath.recordId);
    setRestoredRecordIds((current) => {
      const next = new Set(current);
      next.delete(selectedPath.recordId);
      return next;
    });
    if (selectedPath.sourceState === "stringified") {
      setExpandedStringifiedPaths((current) => new Set(current).add(selectedPath.pathText));
    }
    scrollToPath(selectedPath.recordId, selectedPath.pathText);
  };

  const handleCopySelectedSubtree = async () => {
    const context = await getSelectedNodeContext();
    if (!context) {
      return;
    }

    await navigator.clipboard.writeText(
      JSON.stringify(materializeNode(context.target.node), null, 2),
    );
  };

  const handleCopySelectedEscapedString = async () => {
    const context = await getSelectedNodeContext();
    const rawString = context?.target.node.rawString;
    if (typeof rawString !== "string") {
      return;
    }

    await navigator.clipboard.writeText(JSON.stringify(rawString));
  };

  const handleCopySelectedValue = async () => {
    const context = await getSelectedNodeContext();
    if (!context) {
      return;
    }

    const node = context.target.node;
    const value =
      node.wasStringified && typeof node.rawString === "string"
        ? node.rawString
        : materializeNode(node);
    await navigator.clipboard.writeText(
      typeof value === "string" ? value : JSON.stringify(value, null, 2),
    );
  };

  const handleCopySelectedDebugBundle = async () => {
    const context = await getSelectedNodeContext();
    if (!context || !selectedPath) {
      return;
    }

    const sourceLine = context.target.sourceLine;
    await navigator.clipboard.writeText(
      JSON.stringify(
        {
          recordId: context.record.id,
          recordLine: context.record.lineNumber,
          path: selectedPath.jsonPath,
          jqPath: selectedPath.jqPath,
          parseStatus: context.record.node ? "success" : "failed",
          type: context.target.kind,
          source: context.target.sourceState,
          ...(typeof sourceLine === "number" ? { sourceLine } : {}),
          value: materializeNode(context.target.node),
        },
        null,
        2,
      ),
    );
  };

  const handleSelectNode = (record: JsonlRecord, row: TreeRow) => {
    setSelectedPath(createSelectionFromRow(record, row));
    setActiveRecordId(record.id);
    scrollToPath(record.id, row.pathText);
  };

  const handleSelectRecord = (record: JsonlRecord) => {
    setActiveRecordId(record.id);
    setSelectedRecordId(record.id);
    setFocusedPath((current) => (current?.recordId === record.id ? current : null));
    scrollRequestIdRef.current += 1;
    setRecordScrollTarget({ recordId: record.id, requestId: scrollRequestIdRef.current });
  };

  const handleOverviewErrorSelect = (recordId: string) => {
    const record = result.records.find((candidate) => candidate.id === recordId);
    if (!record) {
      return;
    }

    qi.setRecordFilter("errors");
    handleSelectRecord(record);
  };

  const handleActiveRecordChange = useCallback((recordId: string) => {
    setActiveRecordId((current) => (current === recordId ? current : recordId));
  }, []);

  const statsLabel =
    recordFilter === "all"
      ? t("stats.label", {
          total: result.stats.total,
          success: result.stats.success,
          failed: result.stats.failed,
        })
      : t("stats.filteredLabel", {
          shown: visibleStats.total,
          total: result.stats.total,
          success: visibleStats.success,
          failed: visibleStats.failed,
        });
  const progressLabel = progress.done
    ? statsLabel
    : `${statsLabel} · ${t("stats.progress", {
        processed: progress.processedLines,
        elapsed: Math.round(progress.elapsedMs),
      })}`;
  const statusFile = sourceFile ?? importedFile;
  const sourceFileStatus = readingFile
    ? t("input.readingFile", {
        name: readingFile.name,
        size: formatFileSize(readingFile.size),
      })
    : statusFile
      ? t(progress.done ? "input.loadedFile" : "input.parsingFile", {
          name: statusFile.name,
          size: formatFileSize(statusFile.size),
          processed: progress.processedLines,
        })
      : undefined;
  const sourceFileBusy = Boolean(readingFile || (statusFile && !progress.done));
  const filterLabel = (() => {
    switch (recordFilter) {
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
  })();
  const toolbarSummary = pathError
    ? pathError
    : searchQuery || recordFilter !== "all"
      ? `${filterLabel} · ${visibleStats.total}/${result.stats.total} · ${
          searchQuery ? `${matchCount} ${t("filter.matches")}` : progressLabel
        }`
      : progressLabel;
  const toolbarInPathMode = qi.mode === "path";
  const toolbarMatchCount = toolbarInPathMode ? pathMatches.length : matchCount;
  const toolbarMatchIndex = toolbarInPathMode ? currentPathMatchIndex : currentMatchIndex;
  const handlePrevToolbarMatch = toolbarInPathMode ? qi.prevPathMatch : qi.prevMatch;
  const handleNextToolbarMatch = toolbarInPathMode ? qi.nextPathMatch : qi.nextMatch;
  const output = (
    <div ref={outputRef} className="flex flex-col gap-3">
      <Toolbar
        summary={toolbarSummary}
        query={toolbarQuery}
        matchCount={toolbarMatchCount}
        currentMatchIndex={toolbarMatchIndex}
        onQueryChange={qi.setToolbarQuery}
        onSubmitQuery={qi.submitToolbarQuery}
        onPrevMatch={handlePrevToolbarMatch}
        onNextMatch={handleNextToolbarMatch}
        onClearQuery={qi.clearToolbarQuery}
        onOpenCommandPalette={handleOpenCommandPalette}
        onCopyJsonl={handleCopyJsonl}
        onCopyFormattedJson={handleCopyFormattedJson}
        onExportJsonl={handleExportJsonl}
        onExportFormattedJson={handleExportFormattedJson}
        onExpandAll={handleExpandAll}
        onRestoreAll={handleRestoreAll}
      />
      {fileOverview.total > 0 ? (
        <FileOverview
          overview={fileOverview}
          format={result.format}
          visibleCount={visibleStats.total}
          onSelectNestedPath={qi.overviewPathSelect}
          onSearchFieldValue={qi.overviewFieldValueSearch}
          onSelectError={handleOverviewErrorSelect}
        />
      ) : null}
      <RecordList
        records={visibleRecords}
        recordInsights={recordInsights}
        hydratedRecords={localFileSource.hydratedRecords}
        expandedStringifiedPaths={expandedStringifiedPaths}
        restoredRecordIds={restoredRecordIds}
        searchMatches={visibleMatches ?? []}
        activeMatch={activeMatch}
        scrollTarget={scrollTarget}
        recordScrollTarget={recordScrollTarget}
        selectedPath={selectedPath}
        focusedPath={focusedPath}
        onTogglePath={handleTogglePath}
        onCopyRecord={handleCopyRecord}
        onCopyRawLine={handleCopyRawLine}
        onCopyError={handleCopyRecordError}
        onCopyPath={(path) => navigator.clipboard.writeText(path)}
        onCopyNode={handleCopyNode}
        onSelectNode={handleSelectNode}
        onActiveRecordChange={handleActiveRecordChange}
        onRestoreRecord={(recordId) => {
          setRestoredRecordIds((current) => new Set(current).add(recordId));
          if (selectedPath?.recordId === recordId) {
            setSelectedPath(null);
            setScrollTarget(null);
          }
          if (focusedPath?.recordId === recordId) {
            setFocusedPath(null);
          }
        }}
        onHydrateRecord={localFileSource.hydrateRecord}
        onClearFocus={() => setFocusedPath(null)}
        onHoverPath={(path) => setHoveredPath(path ?? "$")}
      />
    </div>
  );

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <header className="sticky top-0 z-30 flex h-11 items-center justify-between border-b border-border bg-[var(--background)]/80 px-4 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <h1 className="m-0 text-[15px] font-semibold tracking-tight text-text-primary">
            Unquote
          </h1>
          <span className="font-mono text-[11px] text-text-muted">JSON / JSONL</span>
        </div>
        <div className="flex items-center gap-1">
          {chromeWebStoreUrl ? (
            <a
              href={chromeWebStoreUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center justify-center gap-2 rounded-md bg-surface-300 px-3 text-[13px] font-medium tracking-[0.01em] text-text-primary shadow-sm transition-[transform,box-shadow,background-color,color] duration-150 ease-out hover:-translate-y-px hover:text-accent-hover hover:shadow-md"
            >
              <Chrome className="size-3.5" />
              {t("app.chrome")}
            </a>
          ) : null}
          <LocaleToggle />
          <ThemeToggle theme={theme} onChange={setTheme} />
        </div>
      </header>

      <main
        className={`mx-auto flex w-full max-w-[1800px] flex-col gap-3 px-4 pt-0 lg:px-6 ${
          selectedPath ? "pb-36" : "pb-14"
        }`}
      >
        <Tabs defaultValue="workspace" className="flex flex-col gap-3 lg:hidden">
          <TabsList>
            <TabsTrigger value="workspace">{t("app.tab.input")}</TabsTrigger>
            <TabsTrigger value="output">{t("app.tab.output")}</TabsTrigger>
          </TabsList>
          <TabsContent value="workspace">
            <InputPane
              value={sourceText}
              mode={mode}
              onChange={handleSourceChange}
              onModeChange={setMode}
              sampleOptions={sampleOptions}
              onSampleSelect={handleSampleSelect}
              onOpenFile={handleOpenFile}
              onFileDrop={handleFileDrop}
              onClear={() => handleSourceChange("")}
              onToggleCollapse={() => setSourceCollapsed((current) => !current)}
              sourceStatus={sourceFileStatus}
              sourceBusy={sourceFileBusy}
              sourceProgress={readingFile ? readProgress : null}
              sourceError={sourceParseError}
            />
          </TabsContent>
          <TabsContent value="output">{output}</TabsContent>
        </Tabs>

        <div
          className={`hidden items-start lg:grid ${sourceCollapsed ? "gap-1 lg:grid-cols-[44px_minmax(0,1fr)]" : "gap-3 lg:grid-cols-[minmax(360px,420px)_minmax(0,1fr)] xl:grid-cols-[minmax(420px,520px)_minmax(0,1fr)]"}`}
        >
          <div
            className={`sticky top-11 flex flex-col gap-3 overflow-hidden ${
              selectedPath ? "max-h-[calc(100vh-9rem)]" : "max-h-[calc(100vh-5.75rem)]"
            }`}
          >
            {sourceCollapsed ? (
              <button
                type="button"
                className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-surface-100 text-text-secondary shadow-sm"
                onClick={() => setSourceCollapsed(false)}
                aria-label={t("input.expandSource")}
              >
                <PanelLeftOpen className="size-4" />
              </button>
            ) : (
              <>
                <InputPane
                  value={sourceText}
                  mode={mode}
                  onChange={handleSourceChange}
                  onModeChange={setMode}
                  sampleOptions={sampleOptions}
                  onSampleSelect={handleSampleSelect}
                  onOpenFile={handleOpenFile}
                  onFileDrop={handleFileDrop}
                  onClear={() => handleSourceChange("")}
                  onToggleCollapse={() => setSourceCollapsed((current) => !current)}
                  sourceStatus={sourceFileStatus}
                  sourceBusy={sourceFileBusy}
                  sourceProgress={readingFile ? readProgress : null}
                  sourceError={sourceParseError}
                />
                {hasJsonlRecords(result) ? (
                  <TocPane
                    records={visibleRecords}
                    recordInsights={recordInsights}
                    totalCount={result.stats.total}
                    activeRecordId={activeRecordId}
                    selectedRecordId={selectedRecordId}
                    onSelect={handleSelectRecord}
                    onCopyRawLine={handleCopyRawLine}
                  />
                ) : null}
              </>
            )}
          </div>
          <div className="min-w-0">{output}</div>
        </div>
      </main>
      <CommandPalette
        open={commandPaletteOpen}
        inputValue={commandInput}
        regex={searchRegex}
        caseSensitive={searchCaseSensitive}
        jq={searchJq}
        matchCount={matchCount}
        pathMatchCount={pathMatches.length}
        visibleCount={visibleStats.total}
        totalCount={result.stats.total}
        filterMode={recordFilter}
        onClose={() => setCommandPaletteOpen(false)}
        onInputChange={qi.setCommandInput}
        onSearch={qi.commandSearch}
        onJumpPath={qi.submitToolbarQuery}
        onRegexChange={(value) => qi.setSearchOption("regex", value)}
        onCaseSensitiveChange={(value) => qi.setSearchOption("caseSensitive", value)}
        onJqChange={(value) => qi.setSearchOption("jq", value)}
        onFilterChange={qi.setRecordFilter}
      />
      <StatusFooter
        detectedFormat={detectedFormat}
        statsLabel={progressLabel}
        modeLabel={parseModeLabel}
        pathLabel={hoveredPath}
        inspector={
          selectedPath ? (
            <PathInspector
              selection={selectedPath}
              focused={
                focusedPath?.recordId === selectedPath.recordId &&
                focusedPath.pathText === selectedPath.pathText
              }
              onCopy={(value) => navigator.clipboard.writeText(value)}
              onCopySubtree={handleCopySelectedSubtree}
              onCopyEscapedString={handleCopySelectedEscapedString}
              onCopyValue={handleCopySelectedValue}
              onCopyDebugBundle={handleCopySelectedDebugBundle}
              onFocus={handleFocusSelectedNode}
              onClearFocus={() => setFocusedPath(null)}
              onClear={() => setSelectedPath(null)}
              canCopyEscapedString={selectedPath.sourceState === "stringified"}
            />
          ) : null
        }
      />
    </div>
  );
};
