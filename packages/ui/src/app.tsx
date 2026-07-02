import { materializeNode } from "@unquote/core";
import { toast } from "sonner";
import type { JsonlRecord } from "@unquote/core";
import { Chrome, PanelLeftOpen } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CommandPalette } from "./components/command-palette";
import { FileOverview } from "./components/file-overview";
import { InputPane } from "./components/input-pane";
import type { SourceParseError } from "./components/input-pane";
import { AgentSessionView } from "./components/agent-session-view";
import { LocaleToggle } from "./components/locale-toggle";
import { RecordList } from "./components/record-list";
import { Toaster } from "./components/sonner";
import { ThemeToggle } from "./components/theme-toggle";
import { TocPane } from "./components/toc-pane";
import { Toolbar } from "./components/toolbar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/tabs";
import { useTranslation } from "./i18n/context";
import { useLocalFileSource } from "./hooks/use-local-file-source";
import { useParser } from "./hooks/use-parser";
import { buildNavigationTarget, useQueryInteraction } from "./hooks/use-query-interaction";
import { useExportActions } from "./hooks/use-export-actions";
import { useRecordPipeline } from "./hooks/use-record-pipeline";
import { useThemePreference } from "./hooks/use-theme-preference";
import { useSourceLoader } from "./hooks/use-source-loader";
import { markPerf, measurePerfFn } from "./lib/perf";
import {
  collectStringifiedPaths,
  getRenderedRecord,
  hasJsonlRecords,
  resolveTreePath,
} from "./lib/tree";
import { writeClipboardText } from "./lib/clipboard";
import { isArrayElementPath } from "./lib/path-codec";
import { sourceSamples } from "./lib/source-samples";
import type { SearchOptions, TreeRow } from "./lib/tree";

// Copy builds one giant string and hands it to the clipboard API, which freezes
// the main thread on large data. Export streams via Blob(parts[]) and is safe.
export const copyRecordLimit = 5000;
export const copyBytesLimit = 20_000_000;
export const isCopyAboveThreshold = (recordCount: number, bytes: number) =>
  recordCount > copyRecordLimit || bytes > copyBytesLimit;

interface PathScrollTarget {
  recordId: string;
  pathText: string;
  requestId: number;
}

interface SelectedPath {
  recordId: string;
  pathText: string;
  rawKey: string;
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

const createSelectionFromRow = (record: JsonlRecord, row: TreeRow): SelectedPath => ({
  recordId: record.id,
  pathText: row.pathText,
  rawKey: row.keyLabel,
});

const isTextEditingElement = (element: Element | null) =>
  element instanceof HTMLInputElement ||
  element instanceof HTMLTextAreaElement ||
  element instanceof HTMLSelectElement ||
  (element instanceof HTMLElement && element.isContentEditable);

const formatSelectionCopy = (selection: SelectedPath, value: unknown) => {
  const valueText = JSON.stringify(value, null, 2);
  if (selection.rawKey === "$" || isArrayElementPath(selection.pathText)) {
    return valueText;
  }

  return `${JSON.stringify(selection.rawKey)}: ${valueText}`;
};

const formatParseMode = (format: "json" | "jsonl") => format.toUpperCase();

const isPathInsideFocus = (pathText: string, focusedPath: string) =>
  pathText === focusedPath ||
  pathText.startsWith(`${focusedPath}.`) ||
  pathText.startsWith(`${focusedPath}[`);

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
  const [sourceCollapsed, setSourceCollapsed] = useState(false);
  const resetDerivedStateRef = useRef<() => void>(() => {});
  const {
    mode,
    setMode,
    sourceText,
    sourceFile,
    readingFile,
    readProgress,
    importedFile,
    onSourceChange: handleSourceChange,
    onFileDrop: handleFileDrop,
    onOpenFile: handleOpenFile,
    onCopyRawLine: handleCopyRawLine,
  } = useSourceLoader({
    initialInput,
    onReadFile,
    onRequestOpenFile: onOpenFile,
    onReset: () => resetDerivedStateRef.current(),
    onCollapseSource: () => setSourceCollapsed(true),
    onError: () => toast.error(t("input.readFailed")),
    onCopyError: () => toast.error(t("copy.failed")),
  });
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [expandedStringifiedPaths, setExpandedStringifiedPaths] = useState<Set<string>>(new Set());
  const { theme, setTheme } = useThemePreference();
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [outputView, setOutputView] = useState<"agent" | "json">("json");
  const [selectedPath, setSelectedPath] = useState<SelectedPath | null>(null);
  const [focusedPath, setFocusedPath] = useState<{ recordId: string; pathText: string } | null>(
    null,
  );
  const [scrollTarget, setScrollTarget] = useState<PathScrollTarget | null>(null);
  const [recordScrollTarget, setRecordScrollTarget] = useState<{
    recordId: string;
    requestId: number;
  } | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const scrollRequestIdRef = useRef(0);
  const outputViewSessionKeyRef = useRef<string | null>(null);
  const { result, progress, recordsVersion, agentSession } = useParser(
    sourceText,
    mode === "auto" ? undefined : mode,
    sourceFile,
  );

  const translateError = useCallback(
    (reason: "invalid" | "not-found") => t(reason === "invalid" ? "path.invalid" : "path.notFound"),
    [t],
  );
  const qi = useQueryInteraction({ allRecords: result.records, translateError });
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

  const agentSessionKey = agentSession
    ? [
        agentSession.fileType,
        agentSession.fileName ?? "",
        agentSession.meta.sessionId ?? "",
        agentSession.events.length,
        agentSession.conversationItems.length,
      ].join(":")
    : null;

  useEffect(() => {
    if (outputViewSessionKeyRef.current === agentSessionKey) {
      return;
    }

    outputViewSessionKeyRef.current = agentSessionKey;
    setOutputView(agentSession ? "agent" : "json");
  }, [agentSession, agentSessionKey]);

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
        id: "codex-rollout-jsonl",
        label: t("samples.codexRolloutJsonl"),
        value: sourceSamples.codexRolloutJsonl.source,
        expandedPaths: sourceSamples.codexRolloutJsonl.expandedPaths,
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

  const localFileSource = useLocalFileSource(sourceFile, searchQuery, searchOptions, () =>
    toast.error(t("input.readFailed")),
  );

  const {
    recordInsights,
    recordsById,
    visibleRecords,
    visibleStats,
    fileOverview,
    visibleMatches,
    matchCount,
  } = useRecordPipeline({
    result,
    recordsVersion,
    sourceFile,
    fileMatches: localFileSource.fileMatches,
    searchQuery,
    searchOptions,
    recordFilter,
  });
  // Copy is disabled above a record/byte threshold: the clipboard API freezes the
  // main thread on large strings. Export streams via Blob and stays available.
  const estimatedSourceBytes = sourceFile?.size ?? sourceText.length;
  const isCopyBlocked = isCopyAboveThreshold(visibleRecords.length, estimatedSourceBytes);

  // Keep the match index inside the current match count (the count lives in
  // the pipeline, downstream of the interaction state).
  const { clampMatchIndex } = qi;
  useEffect(() => {
    clampMatchIndex(matchCount);
  }, [clampMatchIndex, matchCount]);

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
      current &&
      (current.recordId !== match.recordId || !isPathInsideFocus(match.pathText, current.pathText))
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

  const navigationTarget = useMemo(
    () =>
      buildNavigationTarget(
        { pathMatches, currentPathMatchIndex, currentMatchIndex },
        qi.mode,
        matchCount > 0,
        qi.navVersion,
      ),
    [currentMatchIndex, currentPathMatchIndex, matchCount, pathMatches, qi.mode, qi.navVersion],
  );

  // React to interaction-driven navigation: a path jump selects/expands the
  // target node and scrolls to it; a search re-navigation scrolls to the match.
  useEffect(() => {
    const target = navigationTarget;
    if (!target) {
      return;
    }

    if (target.kind === "path") {
      setSelectedPath({
        recordId: target.recordId,
        pathText: target.pathText,
        rawKey: target.rawKey,
      });
      setActiveRecordId(target.recordId);
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
  }, [navigationTarget]);

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

  const resetDerivedState = () => {
    setExpandedStringifiedPaths(new Set());
    setSelectedPath(null);
    setSelectedRecordId(null);
    setFocusedPath(null);
    setScrollTarget(null);
    setRecordScrollTarget(null);
    qi.reset();
  };
  resetDerivedStateRef.current = resetDerivedState;

  const handleSampleSelect = (sample: { value: string; expandedPaths: readonly string[] }) => {
    setMode("auto");
    handleSourceChange(sample.value);
    setExpandedStringifiedPaths(new Set(sample.expandedPaths));
  };

  const {
    onCopyJsonl,
    onCopyFormattedJson,
    onExportJsonl,
    onExportFormattedJson,
    onCopyRecord,
    onCopyRecordError,
  } = useExportActions({
    visibleRecords,
    getFullRecords: localFileSource.getFullRecords,
    format: result.format,
    isCopyBlocked,
  });

  const handleExpandAll = () => {
    const all = measurePerfFn("expand:all:collect", () => {
      const paths = new Set<string>();
      visibleRecords.forEach((record) => {
        collectStringifiedPaths(record, expandedStringifiedPaths).forEach((path) => {
          paths.add(path);
        });
      });
      return paths;
    });
    setExpandedStringifiedPaths(all);
    markPerf("expand:all:set-state");
  };

  const handleCollapseAll = () => {
    setExpandedStringifiedPaths(new Set());
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

  const getSelectedNodeContext = async () => {
    if (!selectedPath) {
      return null;
    }

    const record = result.records.find((candidate) => candidate.id === selectedPath.recordId);
    const [copyRecord] = record ? await localFileSource.getFullRecords([record]) : [];
    const renderedRecord = copyRecord ? getRenderedRecord(copyRecord) : null;
    const resolved = renderedRecord?.node
      ? resolveTreePath([renderedRecord], selectedPath.pathText)
      : null;

    return copyRecord && resolved?.ok ? { record: copyRecord, target: resolved.target } : null;
  };

  const handleCopySelectedSubtree = async () => {
    let context: Awaited<ReturnType<typeof getSelectedNodeContext>>;
    try {
      context = await getSelectedNodeContext();
    } catch {
      toast.error(t("input.readFailed"));
      return;
    }
    if (!context || !selectedPath) {
      return;
    }

    const text = formatSelectionCopy(selectedPath, materializeNode(context.target.node));
    if (!(await writeClipboardText(text))) {
      toast.error(t("copy.failed"));
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "c") {
        return;
      }

      if (!selectedPath || commandPaletteOpen) {
        return;
      }

      const selectedText = window.getSelection?.()?.toString() ?? "";
      if (selectedText || isTextEditingElement(document.activeElement)) {
        return;
      }

      event.preventDefault();
      void handleCopySelectedSubtree();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commandPaletteOpen, handleCopySelectedSubtree, selectedPath]);

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
  // Bind the current frame's pipeline values into the interaction callbacks;
  // events dispatch after commit, so these closures always see the latest.
  const handleSubmitToolbarQuery = (value: string) => qi.submitToolbarQuery(value, visibleRecords);
  const handlePrevToolbarMatch = toolbarInPathMode
    ? qi.prevPathMatch
    : () => qi.prevMatch(matchCount);
  const handleNextToolbarMatch = toolbarInPathMode
    ? qi.nextPathMatch
    : () => qi.nextMatch(matchCount);
  const jsonOutput = (
    <div ref={outputRef} className="flex flex-col gap-3">
      <Toolbar
        summary={toolbarSummary}
        query={toolbarQuery}
        matchCount={toolbarMatchCount}
        currentMatchIndex={toolbarMatchIndex}
        onQueryChange={qi.setToolbarQuery}
        onSubmitQuery={handleSubmitToolbarQuery}
        onPrevMatch={handlePrevToolbarMatch}
        onNextMatch={handleNextToolbarMatch}
        onClearQuery={qi.clearToolbarQuery}
        onOpenCommandPalette={handleOpenCommandPalette}
        onCopyJsonl={onCopyJsonl}
        onCopyFormattedJson={onCopyFormattedJson}
        onExportJsonl={onExportJsonl}
        onExportFormattedJson={onExportFormattedJson}
        onExpandAll={handleExpandAll}
        onCollapseAll={handleCollapseAll}
        hasExpandedStringified={expandedStringifiedPaths.size > 0}
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
        searchMatches={visibleMatches ?? []}
        activeMatch={activeMatch}
        scrollTarget={scrollTarget}
        recordScrollTarget={recordScrollTarget}
        selectedPath={selectedPath}
        focusedPath={focusedPath}
        onTogglePath={handleTogglePath}
        onCopyRecord={onCopyRecord}
        onCopyRawLine={handleCopyRawLine}
        onCopyError={onCopyRecordError}
        onSelectNode={handleSelectNode}
        onActiveRecordChange={handleActiveRecordChange}
        onHydrateRecord={localFileSource.hydrateRecord}
        onClearFocus={() => setFocusedPath(null)}
      />
    </div>
  );
  const output = agentSession ? (
    <Tabs
      value={outputView}
      onValueChange={(value) => setOutputView(value === "agent" ? "agent" : "json")}
    >
      <TabsList className="mb-3">
        <TabsTrigger value="agent">{t("app.tab.agent")}</TabsTrigger>
        <TabsTrigger value="json">{t("app.tab.json")}</TabsTrigger>
      </TabsList>
      <TabsContent value="agent">
        <AgentSessionView
          session={agentSession}
          recordsById={recordsById}
          recordInsights={recordInsights}
          expandedStringifiedPaths={expandedStringifiedPaths}
          selectedPath={selectedPath}
          focusedPath={focusedPath}
          selectedRecordId={selectedRecordId}
          onTogglePath={handleTogglePath}
          onCopyRecord={onCopyRecord}
          onCopyRawLine={handleCopyRawLine}
          onCopyError={onCopyRecordError}
          onSelectNode={handleSelectNode}
          onHydrateRecord={localFileSource.hydrateRecord}
          onClearFocus={() => setFocusedPath(null)}
        />
      </TabsContent>
      <TabsContent value="json">{jsonOutput}</TabsContent>
    </Tabs>
  ) : (
    jsonOutput
  );

  return (
    <div className="uq-shell pb-8">
      <header className="sticky top-0 z-40 flex h-[52px] items-center justify-between border-b border-border bg-[color-mix(in_srgb,var(--canvas)_82%,transparent)] px-4 backdrop-blur-[14px] sm:px-6">
        <div className="flex items-center gap-3.5">
          <span className="nf-led uq-logo-led" />
          <h1 className="m-0 text-[18px] font-medium tracking-[-0.01em] text-text-display">
            UNQUOTE
          </h1>
          <span className="nf-mono-sub nf-dim hidden sm:inline">JSON · JSONL</span>
        </div>
        <div className="flex items-center gap-1">
          {chromeWebStoreUrl ? (
            <a
              href={chromeWebStoreUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center justify-center gap-2 border border-transparent px-3 font-mono text-[11px] uppercase tracking-[0.08em] text-text-secondary transition-[background-color,border-color,color] hover:bg-surface-200 hover:text-text-display"
            >
              <Chrome className="size-3.5" />
              <span className="hidden sm:inline">{t("app.chrome")}</span>
            </a>
          ) : null}
          <LocaleToggle />
          <ThemeToggle theme={theme} onChange={setTheme} />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1760px] flex-col gap-3 px-4 pb-6 pt-3.5 sm:px-6">
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
          className={`hidden items-start lg:grid ${sourceCollapsed ? "gap-3.5 lg:grid-cols-[46px_minmax(0,1fr)]" : "gap-3.5 lg:grid-cols-[minmax(360px,460px)_minmax(0,1fr)]"}`}
        >
          <div className="sticky top-[66px] flex max-h-[calc(100vh-130px)] min-h-0 flex-col gap-3.5 overflow-hidden">
            {sourceCollapsed ? (
              <button
                type="button"
                className="flex size-[42px] items-center justify-center rounded-none border border-border bg-surface-100 text-text-secondary hover:border-border-medium hover:text-text-display"
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
        onJumpPath={handleSubmitToolbarQuery}
        onRegexChange={(value) => qi.setSearchOption("regex", value)}
        onCaseSensitiveChange={(value) => qi.setSearchOption("caseSensitive", value)}
        onJqChange={(value) => qi.setSearchOption("jq", value)}
        onFilterChange={qi.setRecordFilter}
      />
      <Toaster theme={theme} />
    </div>
  );
};
