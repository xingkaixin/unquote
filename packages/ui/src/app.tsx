import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { AppHeader } from "./components/app-header";
import { DeferredLoadBoundary } from "./components/deferred-load-boundary";
import { Toaster } from "./components/sonner";
import { SourceImportPanel } from "./components/source-import-panel";
import type { SourceSampleOption } from "./components/source-import-panel";
import { StatusBar } from "./components/status-bar";
import { TooltipProvider } from "./components/tooltip";
import { useTranslation } from "./i18n/context";
import type { Locale } from "./i18n/i18n";
import { useDesktopWorkspace } from "./hooks/use-desktop-workspace";
import { useGlobalShortcuts } from "./hooks/use-global-shortcuts";
import { useOutputView } from "./hooks/use-output-view";
import { useParser } from "./hooks/use-parser";
import { useQueryInteraction } from "./hooks/use-query-interaction";
import { useRecordWorkspace } from "./hooks/use-record-workspace";
import { useThemePreference } from "./hooks/use-theme-preference";
import { useTrajectoryFilters } from "./hooks/use-trajectory-filters";
import { useSourceLoader } from "./hooks/use-source-loader";
import type { AgentDetailSelection } from "./lib/agent-session/session-types";
import { formatFileSize } from "./lib/format";
import { projectSourceImport, projectSourceView } from "./lib/published-source";
import { sourceSamples } from "./lib/source-samples";
import type { SourceCandidate } from "./lib/source-candidate";
import { toolbarSummary as buildToolbarSummary } from "./lib/toolbar-summary";

const loadAgentOutput = () =>
  import("./components/agent-output").then(({ AgentOutput }) => ({
    default: AgentOutput,
  }));
const AgentOutput = lazy(loadAgentOutput);
const CommandPalette = lazy(() =>
  import("./components/command-palette").then(({ CommandPalette }) => ({
    default: CommandPalette,
  })),
);
const ImportDialog = lazy(() =>
  import("./components/import-dialog").then(({ ImportDialog }) => ({
    default: ImportDialog,
  })),
);
const RecordWorkspace = lazy(() =>
  import("./components/record-workspace").then(({ RecordWorkspace }) => ({
    default: RecordWorkspace,
  })),
);

const formatParseMode = (format: "json" | "jsonl") => format.toUpperCase();

const JsonDiffDialog = lazy(() =>
  import("./components/json-diff-dialog").then(({ JsonDiffDialog }) => ({
    default: JsonDiffDialog,
  })),
);

type ActiveOverlay = "import" | "command" | "diff" | null;

export interface UnquoteAppProps {
  initialInput?: string;
  changelogUrls?: Readonly<Record<Locale, string>>;
  chromeWebStoreUrl?: string;
  edgeAddonsUrl?: string;
}

export const UnquoteApp = ({
  initialInput = "",
  changelogUrls,
  chromeWebStoreUrl,
  edgeAddonsUrl,
}: UnquoteAppProps) => {
  const { t } = useTranslation();
  const isDesktop = useDesktopWorkspace();
  const {
    source,
    operation,
    onSourceChange: handleSourceChange,
    onFileDrop: handleFileDrop,
  } = useSourceLoader({ initialInput });
  const sourceImport = useMemo(() => projectSourceImport(source), [source]);
  const sourceView = useMemo(() => projectSourceView(source), [source]);
  const { theme, setTheme } = useThemePreference();
  const [activeOverlay, setActiveOverlay] = useState<ActiveOverlay>(null);
  const {
    sourceRevision: resultRevision,
    result,
    progress,
    agentSession,
    recordAppend,
  } = useParser({ source, onAgentSessionDetected: loadAgentOutput });
  const hasData = sourceView.hasData;

  const translateError = useCallback(
    (reason: "invalid" | "not-found") => t(reason === "invalid" ? "path.invalid" : "path.notFound"),
    [t],
  );
  const query = useQueryInteraction({
    source,
    resultRevision,
    result,
    recordAppend,
    translateError,
  });
  const recordWorkspace = useRecordWorkspace({
    source,
    result,
    agentSession,
    query,
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
    pathMatchCount,
    currentPathMatchIndex,
    currentMatchIndex,
    mode: queryMode,
    searchStatus,
    searchErrorKind,
    fileOverview,
    visibleStats,
    matchCount,
  } = query.snapshot;
  const { intent: queryIntent } = query;
  const { outputView, setOutputView } = useOutputView(resultRevision, agentSession);
  const trajectoryFilters = useTrajectoryFilters(resultRevision);

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

  const handleOpenCommandPalette = useCallback(() => {
    queryIntent.prepareCommandInput();
    setActiveOverlay("command");
  }, [queryIntent]);

  const commitSourceCandidate = (candidate: SourceCandidate) => {
    if (candidate.kind === "text") {
      handleSourceChange(candidate.text, candidate.mode);
    } else {
      void handleFileDrop(candidate.file, candidate.mode);
    }
    setActiveOverlay(null);
  };

  const handleSampleSelect = (sample: SourceSampleOption) => {
    const nextRevision = handleSourceChange(sample.value, "auto");
    recordWorkspace.setSampleExpansions(nextRevision, sample.expandedPathsByRecord);
    setActiveOverlay(null);
  };

  const handleOpenRecord = useCallback(
    (recordId: string) => {
      if (recordWorkspace.agent.openRecord(recordId)) {
        setOutputView("json");
      }
    },
    [recordWorkspace.agent.openRecord, setOutputView],
  );
  const handleOpenTrajectoryRecord = useCallback(
    (selection: AgentDetailSelection, endpointRecordId: string) => {
      if (!recordWorkspace.agent.openEndpoint(selection, endpointRecordId, { reveal: true })) {
        return;
      }

      setOutputView("json");
    },
    [recordWorkspace.agent.openEndpoint, setOutputView],
  );

  // Global shortcut command table. Shortcuts are read via a ref inside the
  // hook (listener mounts once), so this array can be a fresh literal every
  // render without churn.
  useGlobalShortcuts([
    {
      matches: (event) => (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k",
      allowInTextEditing: true,
      handler: () => {
        if (activeOverlay === "import") {
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
        setActiveOverlay(null);
        return false;
      },
    },
    {
      matches: (event) => (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c",
      handler: () => {
        if (!recordWorkspace.model.active.selectedPath || activeOverlay !== null) {
          return false;
        }
        // A non-empty window selection means the user is copying selected text,
        // not a subtree — let the browser's default copy proceed.
        const selectedText = window.getSelection?.()?.toString() ?? "";
        if (selectedText) {
          return false;
        }

        void recordWorkspace.model.intent.copySelectedValue();
      },
    },
  ]);

  const readingFile = operation.kind === "reading" ? operation.file : null;
  const sourceFileStatus = readingFile
    ? t("input.readingFile", {
        name: readingFile.name,
        size: formatFileSize(readingFile.size),
      })
    : sourceView.file
      ? t(progress.done ? "input.loadedFile" : "input.parsingFile", {
          name: sourceView.file.name,
          size: formatFileSize(sourceView.file.size),
          processed: result.stats.total,
        })
      : undefined;
  const sourceFileBusy = Boolean(readingFile || (sourceView.file && !progress.done));
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
      initialDraft={sourceImport.draft}
      initialFile={sourceImport.file}
      initialMode={sourceImport.mode}
      onCommit={commitSourceCandidate}
      samples={sampleOptions}
      onSampleSelect={handleSampleSelect}
      textareaClassName={textareaClassName}
    />
  );
  const output = (
    <DeferredLoadBoundary resetKey={`${resultRevision}:${outputView}`}>
      <Suspense fallback={null}>
        {agentSession && outputView !== "json" ? (
          <AgentOutput
            session={agentSession}
            outputView={outputView}
            isDesktop={isDesktop}
            filters={trajectoryFilters}
            detailSelection={recordWorkspace.agent.detailSelection}
            resolveRecordById={recordWorkspace.agent.resolveRecordById}
            requestFullRecordById={recordWorkspace.agent.requestFullRecordById}
            onDetailSelectionChange={recordWorkspace.agent.selectDetail}
            onOpenRecord={handleOpenRecord}
            onOpenTrajectoryRecord={handleOpenTrajectoryRecord}
          />
        ) : (
          <RecordWorkspace isDesktop={isDesktop} model={recordWorkspace.model} />
        )}
      </Suspense>
    </DeferredLoadBoundary>
  );
  const emptyState = (
    <div className="uq-import-empty flex min-h-0 flex-1 justify-center overflow-y-auto px-6 py-10">
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
        data-source-file={sourceView.streamedFileName ?? ""}
        data-parse-state={progress.done ? "complete" : "pending"}
        data-agent-session={agentSession ? "true" : "false"}
        data-output-view={agentSession ? outputView : "json"}
        data-search-query={searchQuery}
        data-search-state={searchStatus}
        data-expanded-nested={recordWorkspace.model.active.expandedNestedCount}
      >
        <a
          href="#main-content"
          className="sr-only fixed left-4 top-2 z-50 bg-surface-100 px-3 py-2 text-[12px] text-text-primary focus:not-sr-only focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {t("app.skipToContent")}
        </a>
        <AppHeader
          enabled={hasData}
          sourceName={sourceView.file?.name ?? null}
          onOpenImport={() => setActiveOverlay("import")}
          onOpenDiff={() => setActiveOverlay("diff")}
          outputView={agentSession ? outputView : null}
          jsonTabLabel={formatParseMode(result.format)}
          onOutputViewChange={setOutputView}
          search={{
            query: toolbarQuery,
            matchCount: toolbarInPathMode ? pathMatchCount : matchCount,
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
          copyBlocked={recordWorkspace.toolbar.copyBlocked}
          onCopyJsonl={recordWorkspace.toolbar.copyJsonl}
          onCopyFormattedJson={recordWorkspace.toolbar.copyFormattedJson}
          onExportJsonl={recordWorkspace.toolbar.exportJsonl}
          onExportFormattedJson={recordWorkspace.toolbar.exportFormattedJson}
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
          maxDepth={fileOverview.structurePrecision === "exact" ? fileOverview.maxDepth : null}
          expandedNestedCount={recordWorkspace.model.active.expandedNestedCount}
          sourceStatus={sourceFileStatus}
          sourceBusy={sourceFileBusy}
          sourceProgress={operation.kind === "reading" ? operation.progress : null}
          hasData={hasData}
          onClear={() => handleSourceChange("")}
          {...(changelogUrls ? { changelogUrls } : {})}
          {...(chromeWebStoreUrl ? { chromeWebStoreUrl } : {})}
          {...(edgeAddonsUrl ? { edgeAddonsUrl } : {})}
        />
        {activeOverlay ? (
          <DeferredLoadBoundary resetKey={activeOverlay}>
            <Suspense fallback={null}>
              {activeOverlay === "import" ? (
                <ImportDialog open dismissible={hasData} onClose={() => setActiveOverlay(null)}>
                  {importPanel("h-[220px]")}
                </ImportDialog>
              ) : null}
              {activeOverlay === "diff" ? (
                <JsonDiffDialog
                  key={source.sourceRevision}
                  source={source}
                  records={resultRevision === source.sourceRevision ? result.records : []}
                  activeRecord={recordWorkspace.model.active.record}
                  onClose={() => setActiveOverlay(null)}
                />
              ) : null}
              {activeOverlay === "command" ? (
                <CommandPalette
                  open
                  inputValue={commandInput}
                  regex={searchRegex}
                  caseSensitive={searchCaseSensitive}
                  jq={searchJq}
                  matchCount={matchCount}
                  pathMatchCount={pathMatchCount}
                  visibleCount={visibleStats.total}
                  totalCount={result.stats.total}
                  filterMode={recordFilter}
                  nestedFilterScope={recordWorkspace.model.filter.nestedScope}
                  onClose={() => setActiveOverlay(null)}
                  onInputChange={queryIntent.changeCommandInput}
                  onSearch={queryIntent.searchFromCommand}
                  onJumpPath={queryIntent.submitToolbarQuery}
                  onRegexChange={(value) => queryIntent.setOption("regex", value)}
                  onCaseSensitiveChange={(value) => queryIntent.setOption("caseSensitive", value)}
                  onJqChange={(value) => queryIntent.setOption("jq", value)}
                  onFilterChange={queryIntent.setFilter}
                />
              ) : null}
            </Suspense>
          </DeferredLoadBoundary>
        ) : null}
        <Toaster theme={theme} />
      </div>
    </TooltipProvider>
  );
};
