import type { JsonlRecord } from "@unquote/core";
import { toast } from "sonner";
import { useCallback, useMemo, useState } from "react";
import { AppHeader } from "./components/app-header";
import { CommandPalette } from "./components/command-palette";
import { ImportDialog } from "./components/import-dialog";
import { AgentSessionView } from "./components/agent-session-view";
import { JsonWorkspace } from "./components/json-workspace";
import { Toaster } from "./components/sonner";
import { SourceImportPanel } from "./components/source-import-panel";
import type { SourceSampleOption } from "./components/source-import-panel";
import { StatusBar } from "./components/status-bar";
import { TooltipProvider } from "./components/tooltip";
import { useTranslation } from "./i18n/context";
import { useDesktopWorkspace } from "./hooks/use-desktop-workspace";
import { useLocalFileSource } from "./hooks/use-local-file-source";
import { useGlobalShortcuts } from "./hooks/use-global-shortcuts";
import { useOutputView } from "./hooks/use-output-view";
import { useParser } from "./hooks/use-parser";
import { useQueryInteraction } from "./hooks/use-query-interaction";
import { useExportActions } from "./hooks/use-export-actions";
import { useThemePreference } from "./hooks/use-theme-preference";
import { useSourceLoader } from "./hooks/use-source-loader";
import { useWorkspaceQueryBinding } from "./hooks/use-workspace-query-binding";
import { useWorkspaceSession } from "./hooks/use-workspace-session";
import { formatFileSize } from "./lib/format";
import { getExpandedStringifiedPaths, mergeExpandedStringifiedPaths } from "./lib/record-expansion";
import { isCopyAboveThreshold } from "./lib/record-export";
import { narrowPathToRecord } from "./lib/record-view";
import type { SearchMatch } from "./lib/record-search";
import type { RecordViewActions } from "./lib/record-view";
import { formatSelectionCopy, resolveSelectedNode } from "./lib/selected-node";
import { sourceSamples } from "./lib/source-samples";
import type { SourceCandidate } from "./lib/source-candidate";
import { toolbarSummary as buildToolbarSummary } from "./lib/toolbar-summary";

const formatParseMode = (format: "json" | "jsonl") => format.toUpperCase();

const noSearchMatches: SearchMatch[] = [];

export interface UnquoteAppProps {
  initialInput?: string;
  chromeWebStoreUrl?: string;
  edgeAddonsUrl?: string;
}

export const UnquoteApp = ({
  initialInput = "",
  chromeWebStoreUrl,
  edgeAddonsUrl,
}: UnquoteAppProps) => {
  const { t } = useTranslation();
  const isDesktop = useDesktopWorkspace();
  const {
    mode,
    sourceText,
    sourceAccess,
    readingFile,
    readProgress,
    importedFile,
    sourceRevision,
    onSourceChange: handleSourceChange,
    onFileDrop: handleFileDrop,
  } = useSourceLoader({ initialInput });
  const workspace = useWorkspaceSession(sourceRevision);
  const {
    activeRecordId,
    detailSelection,
    expandedPaths: expandedStringifiedPathsByRecord,
    searchExpandedPaths: searchExpandedStringifiedPathsByRecord,
    selectedPath,
    scrollIntent,
  } = workspace.state;
  const { theme, setTheme } = useThemePreference();
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const forcedFormat = sourceAccess ? "jsonl" : mode === "auto" ? undefined : mode;
  const {
    sourceRevision: resultRevision,
    result,
    progress,
    agentSession,
    recordAppend,
  } = useParser({
    input: sourceText,
    forcedFormat,
    sourceAccess,
    sourceRevision,
  });
  const hasData = Boolean(sourceAccess || importedFile) || sourceText.trim().length > 0;

  const translateError = useCallback(
    (reason: "invalid" | "not-found") => t(reason === "invalid" ? "path.invalid" : "path.notFound"),
    [t],
  );
  const query = useQueryInteraction({
    sourceRevision,
    resultRevision,
    result,
    sourceText,
    sourceAccess,
    forcedFormat,
    recordAppend,
    translateError,
    onNavigate: workspace.navigate,
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
    fileOverview,
    recordInsights,
    recordsById,
    visibleRecords,
    visibleStats,
    visibleMatches,
    matchCount,
  } = query.snapshot;
  const { intent: queryIntent } = query;
  const { outputView, setOutputView } = useOutputView(agentSession);

  const sampleOptions = useMemo<SourceSampleOption[]>(
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

  const localFileSource = useLocalFileSource(sourceAccess, sourceRevision);
  // Copy is disabled above a record/byte threshold: the clipboard API freezes the
  // main thread on large strings. Export streams via Blob and stays available.
  const estimatedSourceBytes = sourceAccess?.size ?? sourceText.length;
  const isCopyBlocked = isCopyAboveThreshold(visibleRecords.length, estimatedSourceBytes);

  const activeMatch = useWorkspaceQueryBinding({
    query: query.snapshot,
    workspace,
  });

  const displayedExpandedStringifiedPathsByRecord = useMemo(
    () =>
      mergeExpandedStringifiedPaths(
        expandedStringifiedPathsByRecord,
        searchExpandedStringifiedPathsByRecord,
      ),
    [expandedStringifiedPathsByRecord, searchExpandedStringifiedPathsByRecord],
  );
  // Same rule as reconcileWorkspaceSelection's fallback, applied during render:
  // the reducer only catches up in an effect, which would otherwise leave the
  // workspace record-less for the first paint of every parse.
  const activeRecord = useMemo(
    () =>
      visibleRecords.find((record) => record.id === activeRecordId) ?? visibleRecords[0] ?? null,
    [activeRecordId, visibleRecords],
  );
  const displayedRecordId = activeRecord?.id ?? "";
  const expandedNestedCount = getExpandedStringifiedPaths(
    displayedExpandedStringifiedPathsByRecord,
    displayedRecordId,
  ).size;

  const handleOpenCommandPalette = useCallback(() => {
    queryIntent.prepareCommandInput();
    setCommandPaletteOpen(true);
  }, [queryIntent]);

  const commitSourceCandidate = (candidate: SourceCandidate) => {
    if (candidate.kind === "text") {
      handleSourceChange(candidate.text, candidate.mode);
    } else {
      void handleFileDrop(candidate.file, candidate.mode);
    }
    setImportOpen(false);
  };

  const handleSampleSelect = (sample: SourceSampleOption) => {
    const nextRevision = handleSourceChange(sample.value, "auto");
    workspace.setSampleExpansions(nextRevision, sample.expandedPathsByRecord);
    setImportOpen(false);
  };

  const {
    copyText,
    onCopyJsonl,
    onCopyFormattedJson,
    onExportJsonl,
    onExportFormattedJson,
    onCopyRecord,
    onCopyRawLine,
    onCopyRecordError,
  } = useExportActions({
    visibleRecords,
    resolveRecords: localFileSource.resolveRecords,
    sourceAccess,
    format: result.format,
    isCopyBlocked,
    sourceRevision,
  });
  const recordViewActions = useMemo<RecordViewActions>(
    () => ({
      togglePath: workspace.togglePath,
      copyRecord: onCopyRecord,
      copyRawLine: onCopyRawLine,
      copyError: onCopyRecordError,
      selectNode: workspace.selectNode,
      requestFullRecord: localFileSource.requestFullRecord,
    }),
    [
      localFileSource.requestFullRecord,
      onCopyRawLine,
      onCopyRecord,
      onCopyRecordError,
      workspace.selectNode,
      workspace.togglePath,
    ],
  );
  const renderedActiveRecord = useMemo(
    () => (activeRecord ? localFileSource.resolveRecord(activeRecord) : null),
    [activeRecord, localFileSource.resolveRecord],
  );
  const turnIndexByRecordId = useMemo(() => {
    if (!agentSession) {
      return null;
    }

    const turnIndexes = new Map<string, number>();
    for (const event of agentSession.events) {
      if (event.turnIndex !== undefined && !turnIndexes.has(event.recordId)) {
        turnIndexes.set(event.recordId, event.turnIndex);
      }
    }
    return turnIndexes;
  }, [agentSession]);
  const visibleMatchesByRecord = useMemo(() => {
    const matchesByRecord = new Map<string, SearchMatch[]>();
    for (const match of visibleMatches ?? []) {
      const matches = matchesByRecord.get(match.recordId);
      if (matches) {
        matches.push(match);
      } else {
        matchesByRecord.set(match.recordId, [match]);
      }
    }
    return matchesByRecord;
  }, [visibleMatches]);

  // Expansion is scoped to the record on screen: a Preview Record only lists
  // top-level nested fields, so expand from the Full Record where one exists or
  // stringified JSON under a plain container stays unreachable from here.
  const handleExpandAll = useCallback(() => {
    workspace.expandAll(
      renderedActiveRecord ? [renderedActiveRecord] : [],
      displayedExpandedStringifiedPathsByRecord,
    );
  }, [displayedExpandedStringifiedPathsByRecord, renderedActiveRecord, workspace.expandAll]);

  const handleCollapseAll = useCallback(() => {
    workspace.collapseAll(activeRecord ? [activeRecord.id] : []);
  }, [activeRecord, workspace.collapseAll]);

  const handleCopySelectedSubtree = useCallback(
    () =>
      copyText(async () => {
        if (!selectedPath) {
          return null;
        }

        const record = result.records.find((candidate) => candidate.id === selectedPath.recordId);
        let copyRecord: JsonlRecord | undefined;
        try {
          [copyRecord] = record ? await localFileSource.resolveRecords([record]) : [];
        } catch {
          toast.error(t("input.readFailed"));
          return null;
        }

        const resolved = copyRecord ? resolveSelectedNode(copyRecord, selectedPath) : null;
        return resolved ? formatSelectionCopy(selectedPath, resolved.node) : null;
      }),
    [copyText, localFileSource.resolveRecords, result.records, selectedPath, t],
  );

  const handleOpenRecord = useCallback(
    (recordId: string) => {
      setOutputView("json");
      const record = recordsById.get(recordId);
      if (record) {
        workspace.selectRecord(record);
      }
    },
    [recordsById, setOutputView, workspace.selectRecord],
  );

  const handleCopySelectedPath = useCallback(
    () => copyText(async () => selectedPath?.pathText ?? null),
    [copyText, selectedPath],
  );

  // Global shortcut command table. Shortcuts are read via a ref inside the
  // hook (listener mounts once), so this array can be a fresh literal every
  // render without churn.
  useGlobalShortcuts([
    {
      matches: (event) => (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k",
      allowInTextEditing: true,
      handler: () => {
        if (importOpen) {
          return false;
        }

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

  const statusFile = sourceAccess ?? importedFile;
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
  const importPanel = (textareaClassName: string) => (
    <SourceImportPanel
      initialDraft={sourceText}
      initialFile={sourceAccess?.getFile() ?? importedFile}
      initialMode={mode}
      onCommit={commitSourceCandidate}
      samples={sampleOptions}
      onSampleSelect={handleSampleSelect}
      textareaClassName={textareaClassName}
    />
  );
  const jsonOutput = (
    <JsonWorkspace
      isDesktop={isDesktop}
      filterBar={{
        mode: recordFilter,
        onChange: queryIntent.setFilter,
        shown: visibleStats.total,
        total: result.stats.total,
      }}
      rail={{
        records: visibleRecords,
        recordInsights,
        turnIndexByRecordId,
        activeRecordId: displayedRecordId,
        scrollIntent,
        onSelect: workspace.selectRecord,
      }}
      tree={{
        record: renderedActiveRecord,
        expandedStringifiedPaths: getExpandedStringifiedPaths(
          displayedExpandedStringifiedPathsByRecord,
          displayedRecordId,
        ),
        searchMatches: visibleMatchesByRecord.get(displayedRecordId) ?? noSearchMatches,
        activeMatchPath: narrowPathToRecord(activeMatch, displayedRecordId),
        scrollIntent,
        selectedPath: narrowPathToRecord(selectedPath, displayedRecordId),
        expandedNestedCount,
        actions: recordViewActions,
        onExpandAll: handleExpandAll,
        onCollapseAll: handleCollapseAll,
      }}
      inspector={{
        record: renderedActiveRecord,
        selectedPath,
        hasNestedJson: (recordInsights.get(displayedRecordId)?.nestedJsonCount ?? 0) > 0,
        onCopyValue: handleCopySelectedSubtree,
        onCopyPath: handleCopySelectedPath,
        onExpandNested: handleExpandAll,
      }}
    />
  );
  const output =
    agentSession && outputView === "agent" ? (
      <AgentSessionView
        session={agentSession}
        isDesktop={isDesktop}
        detailSelection={detailSelection}
        onDetailSelectionChange={workspace.selectAgentDetail}
        onOpenRecord={handleOpenRecord}
      />
    ) : (
      jsonOutput
    );
  const emptyState = (
    <div className="flex min-h-0 flex-1 justify-center overflow-y-auto px-6 py-10">
      <div className="my-auto flex w-full max-w-[660px] flex-col gap-6">
        <div className="flex flex-col gap-2.5">
          <span className="font-mono text-[11px] uppercase tracking-[var(--tracking-tag)] text-accent">
            {t("empty.eyebrow")}
          </span>
          <h2 className="m-0 text-[28px] font-semibold tracking-[-0.02em] text-text-primary">
            {t("empty.headline")}
          </h2>
          <p className="m-0 text-[14px] leading-[23px] text-text-secondary">
            {t("empty.subtitle")}
          </p>
        </div>
        {importPanel("h-[180px]")}
      </div>
    </div>
  );

  return (
    <TooltipProvider delay={600} closeDelay={0}>
      <div
        className="uq-shell"
        data-source-file={sourceAccess?.name ?? ""}
        data-parse-state={progress.done ? "complete" : "pending"}
        data-agent-session={agentSession ? "true" : "false"}
        data-output-view={agentSession ? outputView : "json"}
        data-search-query={searchQuery}
        data-search-state={searchStatus}
        data-expanded-nested={expandedNestedCount}
      >
        <a
          href="#main-content"
          className="sr-only fixed left-4 top-2 z-50 bg-surface-100 px-3 py-2 text-[12px] text-text-primary focus:not-sr-only focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {t("app.skipToContent")}
        </a>
        <AppHeader
          enabled={hasData}
          sourceName={sourceAccess?.name ?? importedFile?.name ?? null}
          onOpenImport={() => setImportOpen(true)}
          outputView={agentSession ? outputView : null}
          jsonTabLabel={formatParseMode(result.format)}
          onOutputViewChange={setOutputView}
          search={{
            query: toolbarQuery,
            matchCount: toolbarInPathMode ? pathMatches.length : matchCount,
            currentMatchIndex: toolbarInPathMode ? currentPathMatchIndex : currentMatchIndex,
            disabled: !hasData,
            onQueryChange: queryIntent.changeToolbarQuery,
            onSubmitQuery: queryIntent.submitToolbarQuery,
            onClearQuery: queryIntent.clearToolbarQuery,
            onPrevMatch: queryIntent.previousResult,
            onNextMatch: queryIntent.nextResult,
          }}
          onOpenCommandPalette={handleOpenCommandPalette}
          theme={theme}
          onThemeChange={setTheme}
          copyBlocked={isCopyBlocked}
          onCopyJsonl={onCopyJsonl}
          onCopyFormattedJson={onCopyFormattedJson}
          onExportJsonl={onExportJsonl}
          onExportFormattedJson={onExportFormattedJson}
        />

        <main
          id="main-content"
          tabIndex={-1}
          className="flex min-h-0 flex-1 flex-col focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
        >
          {hasData ? output : emptyState}
        </main>
        <StatusBar
          summary={hasData ? toolbarSummary : t("status.empty")}
          failedCount={result.stats.failed}
          onSelectFailed={() => queryIntent.setFilter("errors")}
          maxDepth={fileOverview.maxDepth}
          expandedNestedCount={expandedNestedCount}
          sourceStatus={sourceFileStatus}
          sourceBusy={sourceFileBusy}
          sourceProgress={readingFile ? readProgress : null}
          hasData={hasData}
          onClear={() => handleSourceChange("")}
          {...(chromeWebStoreUrl ? { chromeWebStoreUrl } : {})}
          {...(edgeAddonsUrl ? { edgeAddonsUrl } : {})}
        />
        <ImportDialog open={importOpen} dismissible={hasData} onClose={() => setImportOpen(false)}>
          {importPanel("h-[220px]")}
        </ImportDialog>
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
