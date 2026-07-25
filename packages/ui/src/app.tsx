import { materializeNode } from "@unquote/core";
import { toast } from "sonner";
import { PanelLeftOpen, Store } from "lucide-react";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/tooltip";
import { useTranslation } from "./i18n/context";
import { useDesktopWorkspace } from "./hooks/use-desktop-workspace";
import { useLocalFileSource } from "./hooks/use-local-file-source";
import { useGlobalShortcuts } from "./hooks/use-global-shortcuts";
import { useParser } from "./hooks/use-parser";
import { useQueryInteraction } from "./hooks/use-query-interaction";
import type { QueryNavigationTarget } from "./hooks/use-query-interaction";
import { useExportActions } from "./hooks/use-export-actions";
import { useThemePreference } from "./hooks/use-theme-preference";
import { useSourceLoader } from "./hooks/use-source-loader";
import { useWorkspaceSession } from "./hooks/use-workspace-session";
import { hasJsonlRecords, resolveTreePath } from "./lib/tree";
import { writeClipboardText } from "./lib/clipboard";
import { formatFileSize } from "./lib/format";
import { isArrayElementPath, isPathWithin } from "./lib/path-codec";
import { getExpandedStringifiedPaths, mergeExpandedStringifiedPaths } from "./lib/record-expansion";
import { isCopyAboveThreshold } from "./lib/record-export";
import { resolveHydratedRecord } from "./lib/record-resolution";
import type { RecordViewActions, RecordViewModel } from "./lib/record-view";
import { sourceSamples } from "./lib/source-samples";
import { toolbarSummary as buildToolbarSummary } from "./lib/toolbar-summary";
import type { SearchMatch } from "./lib/tree";

import type { SelectedPath } from "./hooks/use-workspace-session";

const formatSelectionCopy = (selection: SelectedPath, value: unknown) => {
  const valueText = JSON.stringify(value, null, 2);
  if (selection.rawKey === "$" || isArrayElementPath(selection.pathText)) {
    return valueText;
  }

  return `${JSON.stringify(selection.rawKey)}: ${valueText}`;
};

const formatParseMode = (format: "json" | "jsonl") => format.toUpperCase();

const noSearchMatches: SearchMatch[] = [];

export interface UnquoteAppProps {
  initialInput?: string;
  chromeWebStoreUrl?: string;
  onOpenFile?: () => Promise<File | string | null> | File | string | null | void;
  onReadFile?: (file: File) => Promise<string>;
}

export const UnquoteApp = ({
  initialInput = "",
  chromeWebStoreUrl,
  onOpenFile,
  onReadFile,
}: UnquoteAppProps) => {
  const { t } = useTranslation();
  const isDesktopWorkspace = useDesktopWorkspace();
  const [sourceCollapsed, setSourceCollapsed] = useState(false);
  const workspace = useWorkspaceSession();
  const {
    activeRecordId,
    detailSelection,
    expandedPaths: expandedStringifiedPathsByRecord,
    searchExpandedPaths: searchExpandedStringifiedPathsByRecord,
    selectedPath,
    focusedPath,
    scrollIntent,
  } = workspace.state;
  const {
    mode,
    setMode,
    sourceText,
    sourceFile,
    readingFile,
    readProgress,
    importedFile,
    sourceRevision,
    onSourceChange: handleSourceChange,
    onFileDrop: handleFileDrop,
    onOpenFile: handleOpenFile,
    onCopyRawLine: handleCopyRawLine,
  } = useSourceLoader({
    initialInput,
    onReadFile,
    onRequestOpenFile: onOpenFile,
    onReset: workspace.reset,
    onCollapseSource: () => setSourceCollapsed(true),
    onError: () => toast.error(t("input.readFailed")),
    onCopyError: () => toast.error(t("copy.failed")),
  });
  const selectedRecordId = detailSelection?.recordId ?? null;
  const { theme, setTheme } = useThemePreference();
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [outputView, setOutputView] = useState<"agent" | "json">("json");
  const outputRef = useRef<HTMLDivElement>(null);
  const outputViewSessionKeyRef = useRef<string | null>(null);
  const forcedFormat = mode === "auto" ? undefined : mode;
  const { result, progress, agentSession } = useParser(sourceText, forcedFormat, sourceFile, () =>
    toast.error(t("input.readFailed")),
  );

  const translateError = useCallback(
    (reason: "invalid" | "not-found") => t(reason === "invalid" ? "path.invalid" : "path.notFound"),
    [t],
  );
  const handleQueryNavigation = useCallback(
    (navigation: QueryNavigationTarget) => {
      if (navigation.kind === "clear") {
        workspace.clearScrollIntent();
        return;
      }

      if (navigation.kind === "search") {
        workspace.scrollToPath(navigation.recordId, navigation.pathText);
        return;
      }

      workspace.selectPath(
        {
          recordId: navigation.target.recordId,
          pathText: navigation.target.pathText,
          rawKey: navigation.target.rawKey,
        },
        navigation.target.stringifiedPathChain,
      );
    },
    [workspace.clearScrollIntent, workspace.scrollToPath, workspace.selectPath],
  );
  const query = useQueryInteraction({
    result,
    sourceText,
    sourceFile,
    forcedFormat,
    translateError,
    onNavigate: handleQueryNavigation,
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
    mode: queryMode,
    searchStatus,
    searchErrorKind,
    recordInsights,
    recordsById,
    visibleRecords,
    visibleStats,
    fileOverview,
    visibleMatches,
    matchCount,
  } = query.snapshot;
  const { intent: queryIntent } = query;
  const { reset: resetQuery } = queryIntent;
  useEffect(() => {
    resetQuery();
  }, [resetQuery, sourceRevision]);

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
        expandedPathsByRecord: sourceSamples.escapedApiResponse.expandedPathsByRecord,
      },
      {
        id: "agent-tool-call-jsonl",
        label: t("samples.agentToolCallJsonl"),
        value: sourceSamples.agentToolCallJsonl.source,
        expandedPathsByRecord: sourceSamples.agentToolCallJsonl.expandedPathsByRecord,
      },
      {
        id: "codex-rollout-jsonl",
        label: t("samples.codexRolloutJsonl"),
        value: sourceSamples.codexRolloutJsonl.source,
        expandedPathsByRecord: sourceSamples.codexRolloutJsonl.expandedPathsByRecord,
      },
      {
        id: "mixed-valid-invalid-jsonl",
        label: t("samples.mixedValidInvalidJsonl"),
        value: sourceSamples.mixedValidInvalidJsonl.source,
        expandedPathsByRecord: sourceSamples.mixedValidInvalidJsonl.expandedPathsByRecord,
      },
    ],
    [t],
  );

  const localFileSource = useLocalFileSource(sourceFile, () => toast.error(t("input.readFailed")));
  // Copy is disabled above a record/byte threshold: the clipboard API freezes the
  // main thread on large strings. Export streams via Blob and stays available.
  const estimatedSourceBytes = sourceFile?.size ?? sourceText.length;
  const isCopyBlocked = isCopyAboveThreshold(visibleRecords.length, estimatedSourceBytes);

  useEffect(() => {
    workspace.synchronizeSearchExpansions(visibleMatches ?? []);
  }, [visibleMatches, workspace.synchronizeSearchExpansions]);

  const displayedExpandedStringifiedPathsByRecord = useMemo(
    () =>
      mergeExpandedStringifiedPaths(
        expandedStringifiedPathsByRecord,
        searchExpandedStringifiedPathsByRecord,
      ),
    [expandedStringifiedPathsByRecord, searchExpandedStringifiedPathsByRecord],
  );
  const hasExpandedVisibleStringifiedPaths = useMemo(() => {
    let hasAny = false;
    for (const paths of displayedExpandedStringifiedPathsByRecord.values()) {
      if (paths.size > 0) {
        hasAny = true;
        break;
      }
    }
    if (!hasAny) return false;
    // Expansion maps can retain entries for record ids no longer in
    // visibleRecords (e.g. use-source-loader's setSourceMode switches
    // auto/json/jsonl for a text source without resetting expansion state),
    // so a non-empty map entry doesn't guarantee a visible match — always
    // check against visibleRecords rather than short-circuiting.
    return visibleRecords.some(
      (record) =>
        getExpandedStringifiedPaths(displayedExpandedStringifiedPathsByRecord, record.id).size > 0,
    );
  }, [displayedExpandedStringifiedPathsByRecord, visibleRecords]);

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
        isPathWithin(activeMatch.pathText, focusedPath.pathText))
    ) {
      return;
    }

    workspace.clearFocus();
  }, [activeMatch, focusedPath, workspace.clearFocus]);

  const handleOpenCommandPalette = useCallback(() => {
    queryIntent.prepareCommandInput();
    setCommandPaletteOpen(true);
  }, [queryIntent]);

  useEffect(() => {
    workspace.reconcileVisibleRecords(visibleRecords);
  }, [visibleRecords, workspace.reconcileVisibleRecords]);

  const handleSampleSelect = (sample: {
    value: string;
    expandedPathsByRecord: readonly { recordId: string; paths: readonly string[] }[];
  }) => {
    setMode("auto");
    handleSourceChange(sample.value);
    workspace.setSampleExpansions(sample.expandedPathsByRecord);
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
  const recordViewActions = useMemo<RecordViewActions>(
    () => ({
      togglePath: workspace.togglePath,
      copyRecord: onCopyRecord,
      copyRawLine: handleCopyRawLine,
      copyError: onCopyRecordError,
      selectNode: workspace.selectNode,
      hydrateRecord: localFileSource.hydrateRecord,
      clearFocus: workspace.clearFocus,
    }),
    [
      handleCopyRawLine,
      localFileSource.hydrateRecord,
      onCopyRecord,
      onCopyRecordError,
      workspace.clearFocus,
      workspace.selectNode,
      workspace.togglePath,
    ],
  );
  const recordView = useMemo<RecordViewModel>(
    () => ({
      state: {
        recordInsights,
        hydratedRecords: localFileSource.hydratedRecords,
        expandedStringifiedPathsByRecord: displayedExpandedStringifiedPathsByRecord,
        selectedPath,
        focusedPath,
      },
      actions: recordViewActions,
    }),
    [
      displayedExpandedStringifiedPathsByRecord,
      focusedPath,
      localFileSource.hydratedRecords,
      recordInsights,
      recordViewActions,
      selectedPath,
    ],
  );

  const handleExpandAll = () => {
    // Expand from the hydrated record where one exists: a deferred record's
    // preview only lists top-level nested fields, so stringified JSON sitting
    // under a plain container would otherwise be unreachable from here.
    workspace.expandAll(
      visibleRecords.map((record) =>
        resolveHydratedRecord(record, localFileSource.hydratedRecords),
      ),
      displayedExpandedStringifiedPathsByRecord,
    );
  };

  const handleCollapseAll = () => {
    workspace.collapseAll(visibleRecords.map((record) => record.id));
  };

  const getSelectedNodeContext = async () => {
    if (!selectedPath) {
      return null;
    }

    const record = result.records.find((candidate) => candidate.id === selectedPath.recordId);
    const [copyRecord] = record ? await localFileSource.getFullRecords([record]) : [];
    const resolved = copyRecord?.node ? resolveTreePath([copyRecord], selectedPath.pathText) : null;

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

  // Global shortcut command table. Shortcuts are read via a ref inside the
  // hook (listener mounts once), so this array can be a fresh literal every
  // render without churn.
  useGlobalShortcuts([
    {
      matches: (event) => (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k",
      allowInTextEditing: true,
      handler: () => {
        handleOpenCommandPalette();
      },
    },
    {
      matches: (event) => event.key === "Escape",
      allowInTextEditing: true,
      // Escape never preventDefault()s: it has no browser default to suppress here.
      handler: () => {
        setCommandPaletteOpen(false);
        return false;
      },
    },
    {
      matches: (event) => (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c",
      handler: () => {
        if (!selectedPath || commandPaletteOpen) {
          return false;
        }
        // A non-empty window selection means the user is copying selected text,
        // not a subtree — let the browser's default copy proceed.
        const selectedText = window.getSelection?.()?.toString() ?? "";
        if (selectedText) {
          return false;
        }

        void handleCopySelectedSubtree();
      },
    },
  ]);

  const handleOverviewErrorSelect = (recordId: string) => {
    const record = result.records.find((candidate) => candidate.id === recordId);
    if (!record) {
      return;
    }

    queryIntent.setFilter("errors");
    workspace.selectRecord(record);
  };

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
  const toolbarSummary = useMemo(
    () =>
      buildToolbarSummary(
        {
          progress,
          stats: result.stats,
          visibleStats,
          recordFilter,
          searchQuery,
          searchStatus,
          searchErrorKind,
          pathError,
          matchCount,
        },
        t,
      ),
    [
      matchCount,
      pathError,
      progress,
      recordFilter,
      result.stats,
      searchErrorKind,
      searchQuery,
      searchStatus,
      t,
      visibleStats,
    ],
  );
  const toolbarInPathMode = queryMode === "path";
  const toolbarMatchCount = toolbarInPathMode ? pathMatches.length : matchCount;
  const toolbarMatchIndex = toolbarInPathMode ? currentPathMatchIndex : currentMatchIndex;
  // When the source pane is collapsed, its expand affordance relocates into the
  // output's top row instead of reserving a full-height column. Desktop-only:
  // the mobile layout never uses the collapse.
  const expandSourceControl = sourceCollapsed ? (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="uq-icon-button hidden size-7 shrink-0 items-center justify-center border border-transparent bg-surface-50 text-text-secondary transition-colors hover:border-border-medium hover:text-text-display focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent lg:inline-flex"
            onClick={() => setSourceCollapsed(false)}
            aria-label={t("input.expandSource")}
          >
            <PanelLeftOpen className="size-3.5" />
          </button>
        }
      />
      <TooltipContent>{t("input.expandSource")}</TooltipContent>
    </Tooltip>
  ) : null;
  const jsonOutput = (
    <div ref={outputRef} className="flex flex-col gap-3">
      <Toolbar
        leading={agentSession ? null : expandSourceControl}
        summary={toolbarSummary}
        query={toolbarQuery}
        matchCount={toolbarMatchCount}
        currentMatchIndex={toolbarMatchIndex}
        onQueryChange={queryIntent.changeToolbarQuery}
        onSubmitQuery={queryIntent.submitToolbarQuery}
        onPrevMatch={queryIntent.previousResult}
        onNextMatch={queryIntent.nextResult}
        onClearQuery={queryIntent.clearToolbarQuery}
        onOpenCommandPalette={handleOpenCommandPalette}
        onCopyJsonl={onCopyJsonl}
        onCopyFormattedJson={onCopyFormattedJson}
        onExportJsonl={onExportJsonl}
        onExportFormattedJson={onExportFormattedJson}
        onExpandAll={handleExpandAll}
        onCollapseAll={handleCollapseAll}
        hasExpandedStringified={hasExpandedVisibleStringifiedPaths}
      />
      {fileOverview.total > 0 ? (
        <FileOverview
          overview={fileOverview}
          format={result.format}
          visibleCount={visibleStats.total}
          onSelectNestedPath={queryIntent.selectOverviewPath}
          onSearchFieldValue={queryIntent.searchOverviewFieldValue}
          onSelectError={handleOverviewErrorSelect}
        />
      ) : null}
      <RecordList
        records={visibleRecords}
        recordView={recordView}
        searchMatches={visibleMatches ?? noSearchMatches}
        activeMatch={activeMatch}
        scrollIntent={scrollIntent}
        onActiveRecordChange={workspace.reportActiveRecord}
      />
    </div>
  );
  const output = agentSession ? (
    <Tabs
      value={outputView}
      onValueChange={(value) => setOutputView(value === "agent" ? "agent" : "json")}
    >
      <div className="mb-3 flex items-center gap-2">
        {expandSourceControl}
        <TabsList>
          <TabsTrigger value="agent" data-output-tab="agent">
            {t("app.tab.agent")}
          </TabsTrigger>
          <TabsTrigger value="json" data-output-tab="json" translate="no">
            {formatParseMode(result.format)}
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="agent">
        <AgentSessionView
          session={agentSession}
          recordsById={recordsById}
          recordView={recordView}
          detailSelection={detailSelection}
          onDetailSelectionChange={workspace.selectAgentDetail}
        />
      </TabsContent>
      <TabsContent value="json">{jsonOutput}</TabsContent>
    </Tabs>
  ) : (
    jsonOutput
  );
  const inputPane = (
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
      {...(isDesktopWorkspace
        ? { onToggleCollapse: () => setSourceCollapsed((current) => !current) }
        : {})}
      sourceStatus={sourceFileStatus}
      sourceBusy={sourceFileBusy}
      sourceProgress={readingFile ? readProgress : null}
      sourceError={sourceParseError}
    />
  );

  return (
    <TooltipProvider delay={600} closeDelay={0}>
      <div
        className="uq-shell pb-8"
        data-source-file={sourceFile?.name ?? ""}
        data-parse-state={progress.done ? "complete" : "pending"}
        data-agent-session={agentSession ? "true" : "false"}
        data-output-view={agentSession ? outputView : "json"}
        data-search-query={searchQuery}
        data-search-state={searchStatus}
      >
        <a
          href="#main-content"
          className="sr-only fixed left-4 top-2 z-50 bg-surface-100 px-3 py-2 text-[12px] text-text-primary focus:not-sr-only focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {t("app.skipToContent")}
        </a>
        <header className="sticky top-0 z-40 flex h-[52px] items-center justify-between border-b border-border bg-[color-mix(in_srgb,var(--surface)_90%,transparent)] px-4 backdrop-blur-[14px] sm:px-6">
          <div className="flex items-center gap-3.5">
            <h1 className="m-0 text-[18px] font-medium tracking-[-0.01em] text-text-display">
              UNQUOTE
            </h1>
            <span className="nf-mono-sub nf-dim hidden sm:inline" translate="no">
              JSON · JSONL
            </span>
          </div>
          <div className="flex items-center gap-1">
            {chromeWebStoreUrl ? (
              <a
                href={chromeWebStoreUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center justify-center gap-2 border border-transparent px-3 font-mono text-[11px] uppercase tracking-[0.08em] text-text-secondary transition-[background-color,border-color,color] hover:bg-surface-200 hover:text-text-display"
              >
                <Store className="size-3.5" />
                <span className="hidden sm:inline">{t("app.chrome")}</span>
              </a>
            ) : null}
            <LocaleToggle />
            <ThemeToggle theme={theme} onChange={setTheme} />
          </div>
        </header>

        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto flex w-full max-w-[1760px] scroll-mt-[52px] flex-col gap-3 px-4 pb-6 pt-3.5 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent sm:px-6"
        >
          {isDesktopWorkspace ? (
            sourceCollapsed ? (
              <div className="min-w-0">{output}</div>
            ) : (
              <div className="grid grid-cols-[minmax(360px,460px)_minmax(0,1fr)] items-start gap-3.5">
                <div className="sticky top-[66px] flex max-h-[calc(100vh-130px)] min-h-0 flex-col gap-3.5 overflow-hidden">
                  {inputPane}
                  {hasJsonlRecords(result) ? (
                    <TocPane
                      records={visibleRecords}
                      recordInsights={recordInsights}
                      stats={visibleStats}
                      totalCount={result.stats.total}
                      activeRecordId={activeRecordId}
                      selectedRecordId={selectedRecordId}
                      onSelect={workspace.selectRecord}
                      onCopyRawLine={handleCopyRawLine}
                    />
                  ) : null}
                </div>
                <div className="min-w-0">{output}</div>
              </div>
            )
          ) : (
            <Tabs defaultValue="workspace" className="flex flex-col gap-3">
              <TabsList>
                <TabsTrigger value="workspace">{t("app.tab.input")}</TabsTrigger>
                <TabsTrigger value="output">{t("app.tab.output")}</TabsTrigger>
              </TabsList>
              <TabsContent value="workspace">{inputPane}</TabsContent>
              <TabsContent value="output">{output}</TabsContent>
            </Tabs>
          )}
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
          onInputChange={queryIntent.changeCommandInput}
          onSearch={queryIntent.searchFromCommand}
          onJumpPath={queryIntent.submitToolbarQuery}
          onRegexChange={(value) => queryIntent.setOption("regex", value)}
          onCaseSensitiveChange={(value) => queryIntent.setOption("caseSensitive", value)}
          onJqChange={(value) => queryIntent.setOption("jq", value)}
          onFilterChange={queryIntent.setFilter}
        />
        <Toaster theme={theme} />
      </div>
    </TooltipProvider>
  );
};
