import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  type ReactNode,
  type RefObject,
} from "react";
import type { ParseResult } from "@unquote/core";
import { useTranslation } from "../i18n/context";
import type { Locale } from "../i18n/i18n";
import { useDesktopWorkspace } from "../hooks/use-desktop-workspace";
import { useGlobalShortcuts } from "../hooks/use-global-shortcuts";
import { useOutputView } from "../hooks/use-output-view";
import { useParser } from "../hooks/use-parser";
import { useQueryInteraction } from "../hooks/use-query-interaction";
import { useRecordWorkspace } from "../hooks/use-record-workspace";
import { useTrajectoryFilters } from "../hooks/use-trajectory-filters";
import type { AgentDetailSelection } from "../lib/agent-session/session-types";
import { formatFileSize } from "../lib/format";
import type { PublishedSourceRevision, SourceViewProjection } from "../lib/published-source";
import type { SourceMode } from "../lib/source-candidate";
import type { SourceRevision } from "../lib/source-revision";
import type { Theme } from "../lib/theme-preference";
import { toolbarSummary as buildToolbarSummary } from "../lib/toolbar-summary";
import { AppHeader } from "./app-header";
import { deferredComponent } from "./deferred-component";
import { DeferredLoadBoundary } from "./deferred-load-boundary";
import { RecordWorkspace } from "./record-workspace";
import { Toaster } from "./sonner";
import { getTransferFile, isPotentialFileDrag } from "./source-import-panel";
import { StatusBar } from "./status-bar";

const AgentOutput = deferredComponent(() =>
  import("./agent-output").then(({ AgentOutput }) => AgentOutput),
);

const CommandPalette = deferredComponent(() =>
  import("./command-palette").then(({ CommandPalette }) => CommandPalette),
);

const ImportDialog = deferredComponent(() =>
  import("./import-dialog").then(({ ImportDialog }) => ImportDialog),
);

const RecordReportDialog = deferredComponent(() =>
  import("./record-report-dialog").then(({ RecordReportDialog }) => RecordReportDialog),
);

const RecordTableDialog = deferredComponent(() =>
  import("./record-table-dialog").then(({ RecordTableDialog }) => RecordTableDialog),
);

const JsonDiffDialog = deferredComponent(() =>
  import("./json-diff-dialog").then(({ JsonDiffDialog }) => JsonDiffDialog),
);

const formatParseMode = (format: ParseResult["format"]) => format.toUpperCase();

export type ActiveOverlay = "import" | "command" | "diff" | "table" | "report" | null;

export interface PendingSampleExpansion {
  revision: SourceRevision;
  expandedPathsByRecord: readonly { recordId: string; paths: readonly string[] }[];
}

export interface PendingToolbarSearch {
  revision: SourceRevision;
  query: string;
  submitted: boolean;
}

export interface PendingSearchFocus {
  selectionStart: number | null;
  selectionEnd: number | null;
  selectionDirection: "forward" | "backward" | "none" | null;
}

export interface WorkspaceShellDataset {
  parseState: "complete" | "pending";
  agentSession: "true" | "false";
  outputView: string;
  searchQuery: string;
  searchState: string;
  expandedNested: number;
}

export interface LoadedWorkspaceShellProps {
  onShellDatasetChange: (dataset: WorkspaceShellDataset) => void;
  source: PublishedSourceRevision;
  sourceView: SourceViewProjection;
  readingFile: File | null;
  readingProgress: number | null;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  activeOverlay: ActiveOverlay;
  onActiveOverlayChange: (overlay: ActiveOverlay) => void;
  pendingSampleExpansion: PendingSampleExpansion | null;
  onConsumeSampleExpansion: (revision: SourceRevision) => void;
  pendingToolbarSearch: PendingToolbarSearch | null;
  onConsumeToolbarSearch: () => void;
  handoffSearchFocusRef: RefObject<PendingSearchFocus | null>;
  onSourceChange: (value: string, sourceMode?: SourceMode) => SourceRevision;
  onFileDrop: (file: File, sourceMode?: SourceMode) => Promise<void>;
  emptyState: ReactNode;
  importPanel: (textareaClassName: string) => ReactNode;
  changelogUrls?: Readonly<Record<Locale, string>> | undefined;
  chromeWebStoreUrl?: string | undefined;
  edgeAddonsUrl?: string | undefined;
}

export const LoadedWorkspaceShell = ({
  onShellDatasetChange,
  source,
  sourceView,
  readingFile,
  readingProgress,
  theme,
  onThemeChange,
  activeOverlay,
  onActiveOverlayChange,
  pendingSampleExpansion,
  onConsumeSampleExpansion,
  pendingToolbarSearch,
  onConsumeToolbarSearch,
  handoffSearchFocusRef,
  onSourceChange,
  onFileDrop,
  emptyState,
  importPanel,
  changelogUrls,
  chromeWebStoreUrl,
  edgeAddonsUrl,
}: LoadedWorkspaceShellProps) => {
  const { t } = useTranslation();
  const isDesktop = useDesktopWorkspace();
  const {
    sourceRevision: resultRevision,
    result,
    progress,
    agentSession,
    recordAppend,
  } = useParser({ source, onAgentSessionDetected: AgentOutput.preload });
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
    pathErrorReason,
    pathMatchCount,
    currentPathMatchIndex,
    currentMatchIndex,
    mode: queryMode,
    searchRegexInvalid,
    searchStatus,
    searchErrorKind,
    fileOverview,
    visibleStats,
    matchCount,
  } = query.snapshot;
  const { intent: queryIntent } = query;
  const { outputView, setOutputView } = useOutputView(resultRevision, agentSession);
  const trajectoryFilters = useTrajectoryFilters(resultRevision);

  useLayoutEffect(() => {
    if (!pendingSampleExpansion) {
      return;
    }

    recordWorkspace.setSampleExpansions(
      pendingSampleExpansion.revision,
      pendingSampleExpansion.expandedPathsByRecord,
    );
    onConsumeSampleExpansion(pendingSampleExpansion.revision);
  }, [onConsumeSampleExpansion, pendingSampleExpansion, recordWorkspace]);

  useLayoutEffect(() => {
    if (!pendingToolbarSearch) {
      return;
    }

    if (pendingToolbarSearch.revision === source.sourceRevision) {
      if (pendingToolbarSearch.submitted) {
        queryIntent.submitToolbarQuery(pendingToolbarSearch.query);
      } else {
        queryIntent.changeToolbarQuery(pendingToolbarSearch.query);
      }
      if (pendingToolbarSearch.query.trim()) {
        setOutputView("json");
      }
    }
    onConsumeToolbarSearch();
  }, [
    onConsumeToolbarSearch,
    pendingToolbarSearch,
    queryIntent,
    setOutputView,
    source.sourceRevision,
  ]);

  useLayoutEffect(() => {
    const pendingFocus = handoffSearchFocusRef.current;
    if (!pendingFocus) {
      return;
    }

    const input = document.querySelector<HTMLInputElement>(
      '[data-benchmark-action="search-input"]',
    );
    if (!input || input.disabled) {
      handoffSearchFocusRef.current = null;
      return;
    }

    input.focus({ preventScroll: true });
    if (pendingToolbarSearch) {
      return;
    }

    handoffSearchFocusRef.current = null;
    if (pendingFocus.selectionStart !== null && pendingFocus.selectionEnd !== null) {
      const maxOffset = input.value.length;
      input.setSelectionRange(
        Math.min(pendingFocus.selectionStart, maxOffset),
        Math.min(pendingFocus.selectionEnd, maxOffset),
        pendingFocus.selectionDirection ?? undefined,
      );
    }
  }, [handoffSearchFocusRef, pendingToolbarSearch, toolbarQuery]);

  const handleOpenCommandPalette = useCallback(() => {
    queryIntent.prepareCommandInput();
    onActiveOverlayChange("command");
  }, [onActiveOverlayChange, queryIntent]);

  const handleToolbarQueryChange = useCallback(
    (value: string) => {
      queryIntent.changeToolbarQuery(value);
      if (value.trim()) {
        setOutputView("json");
      }
    },
    [queryIntent, setOutputView],
  );
  const handleToolbarQuerySubmit = useCallback(
    (value: string) => {
      queryIntent.submitToolbarQuery(value);
      if (value.trim()) {
        setOutputView("json");
      }
    },
    [queryIntent, setOutputView],
  );
  const handlePreviousResult = useCallback(() => {
    queryIntent.previousResult();
    setOutputView("json");
  }, [queryIntent, setOutputView]);
  const handleNextResult = useCallback(() => {
    queryIntent.nextResult();
    setOutputView("json");
  }, [queryIntent, setOutputView]);
  const handleCommandSearch = useCallback(
    (value: string) => {
      queryIntent.searchFromCommand(value);
      if (value.trim()) {
        setOutputView("json");
      }
    },
    [queryIntent, setOutputView],
  );
  const handleCommandFilterChange = useCallback(
    (filter: typeof recordFilter) => {
      queryIntent.setFilter(filter);
      setOutputView("json");
    },
    [queryIntent, setOutputView],
  );
  const handleSelectFailed = useCallback(() => {
    queryIntent.setFilter("errors");
    setOutputView("json");
  }, [queryIntent, setOutputView]);

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

  useEffect(() => {
    if (!hasData) {
      return;
    }

    const handleWindowDragOver = (event: globalThis.DragEvent) => {
      if (
        event.defaultPrevented ||
        !event.dataTransfer ||
        !isPotentialFileDrag(event.dataTransfer)
      ) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    };

    const handleWindowDrop = (event: globalThis.DragEvent) => {
      if (
        event.defaultPrevented ||
        !event.dataTransfer ||
        !isPotentialFileDrag(event.dataTransfer)
      ) {
        return;
      }
      event.preventDefault();
      const file = getTransferFile(event.dataTransfer);
      if (file) {
        void onFileDrop(file, "auto");
        onActiveOverlayChange(null);
      }
    };

    window.addEventListener("dragover", handleWindowDragOver);
    window.addEventListener("drop", handleWindowDrop);
    return () => {
      window.removeEventListener("dragover", handleWindowDragOver);
      window.removeEventListener("drop", handleWindowDrop);
    };
  }, [hasData, onActiveOverlayChange, onFileDrop]);

  useGlobalShortcuts([
    {
      matches: (event) => (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k",
      allowInTextEditing: true,
      handler: () => {
        if (!hasData || activeOverlay === "import") {
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
        if (activeOverlay === "import" && !hasData) {
          return false;
        }

        onActiveOverlayChange(null);
        return false;
      },
    },
    {
      matches: (event) => (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c",
      handler: () => {
        if (
          outputView !== "json" ||
          !recordWorkspace.model.active.selectedPath ||
          activeOverlay !== null
        ) {
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
  const searchFieldError = searchRegexInvalid
    ? t("search.invalidRegex")
    : toolbarInPathMode && pathErrorReason === "invalid"
      ? pathError
      : searchStatus === "error"
        ? t("search.failed")
        : null;
  const recordsReady = progress.done && resultRevision === source.sourceRevision;
  const output = (
    <DeferredLoadBoundary resetKey={`${resultRevision}:${outputView}`}>
      {agentSession && outputView !== "json" ? (
        <AgentOutput
          // Turn selections belong to one Source Revision.
          key={resultRevision}
          session={agentSession}
          outputView={outputView}
          isDesktop={isDesktop}
          filters={trajectoryFilters}
          detailSelection={recordWorkspace.agent.detailSelection}
          reportSource={recordsReady ? { source, records: result.records } : undefined}
          resolveRecordById={recordWorkspace.agent.resolveRecordById}
          requestFullRecordById={recordWorkspace.agent.requestFullRecordById}
          onDetailSelectionChange={recordWorkspace.agent.selectDetail}
          onOpenRecord={handleOpenRecord}
          onOpenTrajectoryRecord={handleOpenTrajectoryRecord}
        />
      ) : (
        <RecordWorkspace isDesktop={isDesktop} model={recordWorkspace.model} />
      )}
    </DeferredLoadBoundary>
  );

  const parseState = progress.done ? "complete" : "pending";
  const agentSessionAttr = agentSession ? "true" : "false";
  const outputViewAttr = agentSession ? outputView : "json";
  const expandedNested = recordWorkspace.model.active.expandedNestedCount;

  useLayoutEffect(() => {
    onShellDatasetChange({
      parseState,
      agentSession: agentSessionAttr,
      outputView: outputViewAttr,
      searchQuery,
      searchState: searchStatus,
      expandedNested,
    });
  }, [
    agentSessionAttr,
    expandedNested,
    onShellDatasetChange,
    outputViewAttr,
    parseState,
    searchQuery,
    searchStatus,
  ]);

  return (
    <>
      <a
        href="#main-content"
        className="sr-only fixed left-4 top-2 z-50 bg-surface-100 px-3 py-2 text-[12px] text-text-primary focus:not-sr-only focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {t("app.skipToContent")}
      </a>
      <AppHeader
        enabled={hasData}
        sourceName={sourceView.file?.name ?? null}
        onOpenImport={() => onActiveOverlayChange("import")}
        onOpenTable={recordsReady ? () => onActiveOverlayChange("table") : undefined}
        onOpenDiff={() => onActiveOverlayChange("diff")}
        outputView={agentSession ? outputView : null}
        jsonTabLabel={formatParseMode(result.format)}
        onOutputViewChange={setOutputView}
        search={{
          query: toolbarQuery,
          matchCount: toolbarInPathMode ? pathMatchCount : matchCount,
          currentMatchIndex: toolbarInPathMode ? currentPathMatchIndex : currentMatchIndex,
          disabled: !hasData,
          searchStatus,
          errorLabel: searchFieldError,
          regex: searchRegex,
          jq: searchJq,
          caseSensitive: searchCaseSensitive,
          onQueryChange: handleToolbarQueryChange,
          onSubmitQuery: handleToolbarQuerySubmit,
          onClearQuery: queryIntent.clearToolbarQuery,
          onPrevMatch: handlePreviousResult,
          onNextMatch: handleNextResult,
        }}
        onOpenCommandPalette={handleOpenCommandPalette}
        theme={theme}
        onThemeChange={onThemeChange}
        copyBlocked={recordWorkspace.toolbar.copyBlocked}
        onCopyJsonl={recordWorkspace.toolbar.copyJsonl}
        onCopyFormattedJson={recordWorkspace.toolbar.copyFormattedJson}
        onExportJsonl={recordWorkspace.toolbar.exportJsonl}
        onExportFormattedJson={recordWorkspace.toolbar.exportFormattedJson}
        onOpenReport={recordsReady ? () => onActiveOverlayChange("report") : undefined}
      />

      <main
        id="main-content"
        tabIndex={-1}
        className="flex min-h-0 flex-1 flex-col focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
      >
        {hasData ? <h1 className="sr-only">Unquote — {t("empty.headline")}</h1> : null}
        {hasData ? output : emptyState}
      </main>
      <StatusBar
        summary={hasData ? toolbarSummary : t("status.empty")}
        failedCount={result.stats.failed}
        onSelectFailed={handleSelectFailed}
        maxDepth={fileOverview.structurePrecision === "exact" ? fileOverview.maxDepth : null}
        expandedNestedCount={recordWorkspace.model.active.expandedNestedCount}
        sourceStatus={sourceFileStatus}
        sourceBusy={sourceFileBusy}
        sourceProgress={readingProgress}
        hasData={hasData}
        onClear={() => onSourceChange("")}
        {...(changelogUrls ? { changelogUrls } : {})}
        {...(chromeWebStoreUrl ? { chromeWebStoreUrl } : {})}
        {...(edgeAddonsUrl ? { edgeAddonsUrl } : {})}
      />
      {activeOverlay ? (
        <DeferredLoadBoundary resetKey={activeOverlay}>
          {activeOverlay === "import" ? (
            <ImportDialog
              open
              dismissible={hasData}
              onClose={() => {
                if (hasData) {
                  onActiveOverlayChange(null);
                }
              }}
            >
              {importPanel("h-[220px]")}
            </ImportDialog>
          ) : null}
          {activeOverlay === "report" ? (
            <RecordReportDialog
              key={source.sourceRevision}
              source={source}
              records={resultRevision === source.sourceRevision ? result.records : []}
              activeLine={recordWorkspace.model.active.record?.lineNumber ?? 1}
              onClose={() => onActiveOverlayChange(null)}
            />
          ) : null}
          {activeOverlay === "table" ? (
            <RecordTableDialog
              key={source.sourceRevision}
              source={source}
              records={resultRevision === source.sourceRevision ? result.records : []}
              selectedPath={recordWorkspace.model.active.selectedPath ?? undefined}
              onOpenRecord={handleOpenRecord}
              onClose={() => onActiveOverlayChange(null)}
            />
          ) : null}
          {activeOverlay === "diff" ? (
            <JsonDiffDialog
              key={source.sourceRevision}
              source={source}
              records={resultRevision === source.sourceRevision ? result.records : []}
              activeRecord={recordWorkspace.model.active.record}
              onClose={() => onActiveOverlayChange(null)}
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
              onClose={() => onActiveOverlayChange(null)}
              onInputChange={queryIntent.changeCommandInput}
              onSearch={handleCommandSearch}
              onJumpPath={handleToolbarQuerySubmit}
              onRegexChange={(value) => queryIntent.setOption("regex", value)}
              onCaseSensitiveChange={(value) => queryIntent.setOption("caseSensitive", value)}
              onJqChange={(value) => queryIntent.setOption("jq", value)}
              onFilterChange={handleCommandFilterChange}
            />
          ) : null}
        </DeferredLoadBoundary>
      ) : null}
      <Toaster theme={theme} />
    </>
  );
};
