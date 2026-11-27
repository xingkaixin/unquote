import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { AppHeader } from "./components/app-header";
import { DeferredComponentLoadError, deferredComponent } from "./components/deferred-component";
import { DeferredLoadBoundary } from "./components/deferred-load-boundary";
import type {
  ActiveOverlay,
  LoadedWorkspaceShellProps,
  PendingSampleExpansion,
  PendingSearchFocus,
  PendingToolbarSearch,
  WorkspaceShellDataset,
} from "./components/loaded-workspace-shell";
import { SourceImportPanel } from "./components/source-import-panel";
import type { SourceSampleOption } from "./components/source-import-panel";
import { StatusBar } from "./components/status-bar";
import { TooltipProvider } from "./components/tooltip";
import { useTranslation } from "./i18n/context";
import type { Locale } from "./i18n/i18n";
import { useDeferredComponent } from "./hooks/use-deferred-component";
import { useSourceLoader } from "./hooks/use-source-loader";
import { useThemePreference } from "./hooks/use-theme-preference";
import { formatFileSize } from "./lib/format";
import { projectSourceImport, projectSourceView } from "./lib/published-source";
import type { SourceCandidate, SourceMode } from "./lib/source-candidate";
import type { SourceRevision } from "./lib/source-revision";
import { sourceSamples } from "./lib/source-samples";

export type { SourceMode };

export type UnquoteAnalyticsEvent =
  | {
      name: "parse-source";
      data: {
        input: "text" | "file";
        mode: SourceMode;
        format: "json" | "jsonl" | "sse";
        agent: "true" | "false";
      };
    }
  | { name: "sample-select"; data: { sample: string } }
  | { name: "switch-view"; data: { view: "agent" | "trajectory" | "json" } }
  | { name: "open-tool"; data: { tool: "diff" | "table" | "report" } };

const ImportDialog = deferredComponent(() =>
  import("./components/import-dialog").then(({ ImportDialog }) => ImportDialog),
);

const JsonDiffDialog = deferredComponent(() =>
  import("./components/json-diff-dialog").then(({ JsonDiffDialog }) => JsonDiffDialog),
);

const DeferredToaster = deferredComponent(() =>
  import("./components/sonner").then(({ Toaster }) => Toaster),
);

let loadedWorkspaceShell: ComponentType<LoadedWorkspaceShellProps> | null = null;

let pendingWorkspaceShell: Promise<ComponentType<LoadedWorkspaceShellProps>> | null = null;

const preloadWorkspaceShell = () => {
  pendingWorkspaceShell ??= import("./components/loaded-workspace-shell").then(
    ({ LoadedWorkspaceShell }) => {
      loadedWorkspaceShell = LoadedWorkspaceShell;
      return LoadedWorkspaceShell;
    },
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Loader rejections are not restricted to Error instances.
    (error: unknown) => {
      pendingWorkspaceShell = null;
      throw error;
    },
  );
  return pendingWorkspaceShell;
};

interface WorkspaceShellSlotProps {
  workspaceProps: Omit<LoadedWorkspaceShellProps, "handoffSearchFocusRef">;
  fallback: ReactNode;
}

const WorkspaceShellSlot = ({ workspaceProps, fallback }: WorkspaceShellSlotProps) => {
  const deferred = useDeferredComponent(preloadWorkspaceShell, loadedWorkspaceShell === null);
  const handoffSearchFocusRef = useRef<PendingSearchFocus | null>(null);
  const mountedWorkspaceRef = useRef(false);

  if (deferred.failed) {
    throw new DeferredComponentLoadError();
  }

  const Component = loadedWorkspaceShell ?? deferred.component;
  if (Component && !mountedWorkspaceRef.current && typeof document !== "undefined") {
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && active.dataset.benchmarkAction === "search-input") {
      handoffSearchFocusRef.current = {
        selectionStart: active.selectionStart,
        selectionEnd: active.selectionEnd,
        selectionDirection: active.selectionDirection,
      };
    }
  }

  useLayoutEffect(() => {
    if (Component) {
      mountedWorkspaceRef.current = true;
    }
  }, [Component]);

  return Component ? (
    <Component {...workspaceProps} handoffSearchFocusRef={handoffSearchFocusRef} />
  ) : (
    fallback
  );
};

const noop = () => undefined;

export interface UnquoteAppProps {
  initialInput?: string;
  initialMode?: SourceMode;
  toastHostActive?: boolean;
  renderWelcome?: (
    controls: ReactNode,
    onSelectSample: (sample: SourceSampleOption) => void,
    samples: readonly SourceSampleOption[],
  ) => ReactNode;
  changelogUrls?: Readonly<Record<Locale, string>>;
  chromeWebStoreUrl?: string;
  edgeAddonsUrl?: string;
  onAnalyticsEvent?: (event: UnquoteAnalyticsEvent) => void;
}

export const UnquoteApp = ({
  initialInput = "",
  initialMode = "auto",
  toastHostActive = false,
  renderWelcome,
  changelogUrls,
  chromeWebStoreUrl,
  edgeAddonsUrl,
  onAnalyticsEvent,
}: UnquoteAppProps) => {
  const { t } = useTranslation();
  const [toastActivated, setToastActivated] = useState(toastHostActive);
  const ensureToasterMounted = useCallback(async () => {
    setToastActivated(true);
    await DeferredToaster.preload();
    const { waitForToasterMount } = await import("./components/sonner");
    await waitForToasterMount();
  }, []);
  const {
    source,
    operation,
    onSourceChange: handleSourceChange,
    onFileDrop: handleFileDrop,
  } = useSourceLoader({ initialInput, initialMode, onToastRequired: ensureToasterMounted });
  const sourceImport = useMemo(() => projectSourceImport(source), [source]);
  const sourceView = useMemo(() => projectSourceView(source), [source]);
  const { theme, setTheme } = useThemePreference();
  const [activeOverlay, setActiveOverlay] = useState<ActiveOverlay>(null);
  const lastInputKindRef = useRef<"text" | "file" | null>(null);
  const handleActiveOverlayChange = useCallback(
    (next: ActiveOverlay) => {
      setActiveOverlay(next);
      if (next === "diff" || next === "table" || next === "report") {
        onAnalyticsEvent?.({ name: "open-tool", data: { tool: next } });
      }
    },
    [onAnalyticsEvent],
  );
  const [pendingSampleExpansion, setPendingSampleExpansion] =
    useState<PendingSampleExpansion | null>(null);
  const [pendingToolbarSearch, setPendingToolbarSearch] = useState<PendingToolbarSearch | null>(
    null,
  );
  const hasData = sourceView.hasData;
  const [workspaceActive, setWorkspaceActive] = useState(hasData);
  const [shellDataset, setShellDataset] = useState<WorkspaceShellDataset>(() => ({
    parseState: hasData ? "pending" : "complete",
    agentSession: "false",
    outputView: "json",
    searchQuery: "",
    searchState: "idle",
    expandedNested: 0,
  }));
  const handleShellDatasetChange = useCallback((next: WorkspaceShellDataset) => {
    setShellDataset((current) =>
      current.parseState === next.parseState &&
      current.agentSession === next.agentSession &&
      current.outputView === next.outputView &&
      current.searchQuery === next.searchQuery &&
      current.searchState === next.searchState &&
      current.expandedNested === next.expandedNested
        ? current
        : next,
    );
  }, []);

  if (hasData && !workspaceActive) {
    setWorkspaceActive(true);
  }

  if ((toastHostActive || operation.kind === "reading") && !toastActivated) {
    setToastActivated(true);
  }

  // Warm the workspace chunk after first paint so file drop and sample
  // activation skip module loading without bloating initial JS.
  useEffect(() => {
    if (workspaceActive || loadedWorkspaceShell) {
      return;
    }

    const warm = () => {
      void preloadWorkspaceShell().catch(() => undefined);
    };

    if (typeof window.requestIdleCallback === "function") {
      const idleId = window.requestIdleCallback(warm, { timeout: 1000 });
      return () => window.cancelIdleCallback(idleId);
    }

    const timer = window.setTimeout(warm, 200);
    return () => window.clearTimeout(timer);
  }, [workspaceActive]);

  const sampleOptions = useMemo<SourceSampleOption[]>(
    () => [
      {
        id: "escaped-api-response",
        label: t("samples.escapedApiResponse"),
        value: sourceSamples.escapedApiResponse.source,
        expandedPathsByRecord: sourceSamples.escapedApiResponse.expandedPathsByRecord,
      },
      {
        id: "sse-stream",
        label: t("samples.sseStream"),
        value: sourceSamples.sseStream.source,
        expandedPathsByRecord: sourceSamples.sseStream.expandedPathsByRecord,
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

  const commitSourceCandidate = (candidate: SourceCandidate) => {
    void preloadWorkspaceShell().catch(() => undefined);
    setPendingSampleExpansion(null);
    setPendingToolbarSearch(null);
    lastInputKindRef.current = candidate.kind;
    if (candidate.kind === "text") {
      handleSourceChange(candidate.text, candidate.mode);
    } else {
      void handleFileDrop(candidate.file, candidate.mode);
    }
    setActiveOverlay(null);
  };

  const handleSampleSelect = (sample: SourceSampleOption) => {
    void preloadWorkspaceShell().catch(() => undefined);
    setPendingToolbarSearch(null);
    lastInputKindRef.current = null;
    onAnalyticsEvent?.({ name: "sample-select", data: { sample: sample.id } });
    const nextRevision = handleSourceChange(sample.value, "auto");
    setPendingSampleExpansion({
      revision: nextRevision,
      expandedPathsByRecord: sample.expandedPathsByRecord,
    });
    setActiveOverlay(null);
  };

  const handleParseComplete = useCallback(
    (format: "json" | "jsonl" | "sse", mode: SourceMode, agent: boolean) => {
      const input = lastInputKindRef.current;
      if (!input) {
        return;
      }
      lastInputKindRef.current = null;
      onAnalyticsEvent?.({
        name: "parse-source",
        data: {
          input,
          mode,
          format,
          agent: agent ? "true" : "false",
        },
      });
    },
    [onAnalyticsEvent],
  );

  const handleSwitchView = useCallback(
    (view: "agent" | "trajectory" | "json") => {
      onAnalyticsEvent?.({ name: "switch-view", data: { view } });
    },
    [onAnalyticsEvent],
  );

  const handleConsumeSampleExpansion = useCallback((revision: SourceRevision) => {
    setPendingSampleExpansion((current) => (current?.revision === revision ? null : current));
  }, []);

  const handleConsumeToolbarSearch = useCallback(() => {
    setPendingToolbarSearch(null);
  }, []);

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

  const emptyState = renderWelcome ? (
    renderWelcome(importPanel("h-[180px]"), handleSampleSelect, sampleOptions)
  ) : (
    <div className="uq-import-empty flex min-h-0 flex-1 justify-center overflow-y-auto px-6 py-10">
      <div className="my-auto flex w-full max-w-[660px] flex-col gap-6">
        <div className="flex flex-col gap-2.5">
          <span className="font-mono text-[11px] uppercase tracking-[var(--tracking-tag)] text-accent">
            {t("empty.eyebrow")}
          </span>
          <h1 className="m-0 text-[28px] font-semibold tracking-[-0.02em] text-text-primary">
            {t("empty.headline")}
          </h1>
          <p className="m-0 text-[14px] leading-[23px] text-text-secondary">
            {t("empty.subtitle")}
          </p>
        </div>
        {importPanel("h-[180px]")}
      </div>
    </div>
  );

  const readingFile = operation.kind === "reading" ? operation.file : null;
  const readingProgress = operation.kind === "reading" ? operation.progress : null;
  const sourceFileStatus = readingFile
    ? t("input.readingFile", {
        name: readingFile.name,
        size: formatFileSize(readingFile.size),
      })
    : undefined;

  const shellChrome = (
    <>
      <a
        href="#main-content"
        className="sr-only fixed left-4 top-2 z-50 bg-surface-100 px-3 py-2 text-[12px] text-text-primary focus:not-sr-only focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {t("app.skipToContent")}
      </a>
      <AppHeader
        enabled={hasData}
        actionsDisabled={hasData}
        sourceName={sourceView.file?.name ?? null}
        onOpenImport={() => handleActiveOverlayChange("import")}
        onOpenDiff={() => handleActiveOverlayChange("diff")}
        outputView={null}
        jsonTabLabel="JSON"
        onOutputViewChange={noop}
        search={{
          query:
            pendingToolbarSearch?.revision === source.sourceRevision
              ? pendingToolbarSearch.query
              : "",
          matchCount: 0,
          currentMatchIndex: 0,
          disabled: !hasData,
          searchStatus: "idle",
          errorLabel: null,
          regex: false,
          jq: false,
          caseSensitive: false,
          onQueryChange: (query) =>
            setPendingToolbarSearch({
              revision: source.sourceRevision,
              query,
              submitted: false,
            }),
          onSubmitQuery: (query) =>
            setPendingToolbarSearch({
              revision: source.sourceRevision,
              query,
              submitted: true,
            }),
          onClearQuery: () => setPendingToolbarSearch(null),
          onPrevMatch: noop,
          onNextMatch: noop,
        }}
        onOpenCommandPalette={noop}
        theme={theme}
        onThemeChange={setTheme}
        copyBlocked={false}
        onCopyJsonl={noop}
        onCopyFormattedJson={noop}
        onExportJsonl={noop}
        onExportFormattedJson={noop}
      />

      <main
        id="main-content"
        tabIndex={-1}
        className="flex min-h-0 flex-1 flex-col focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
      >
        {hasData ? <h1 className="sr-only">Unquote — {t("empty.headline")}</h1> : emptyState}
      </main>
      <StatusBar
        summary={hasData ? "" : t("status.empty")}
        failedCount={0}
        onSelectFailed={noop}
        maxDepth={null}
        expandedNestedCount={0}
        sourceStatus={sourceFileStatus}
        sourceBusy={Boolean(readingFile)}
        sourceProgress={readingProgress}
        hasData={hasData}
        onClear={() => {
          setPendingToolbarSearch(null);
          handleSourceChange("");
        }}
        {...(changelogUrls ? { changelogUrls } : {})}
        {...(chromeWebStoreUrl ? { chromeWebStoreUrl } : {})}
        {...(edgeAddonsUrl ? { edgeAddonsUrl } : {})}
      />
      {!workspaceActive && activeOverlay ? (
        <DeferredLoadBoundary resetKey={activeOverlay}>
          {activeOverlay === "import" ? (
            <ImportDialog
              open
              dismissible={false}
              onClose={() => {
                if (hasData) {
                  setActiveOverlay(null);
                }
              }}
            >
              {importPanel("h-[220px]")}
            </ImportDialog>
          ) : null}
          {activeOverlay === "diff" ? (
            <JsonDiffDialog
              key={source.sourceRevision}
              source={source}
              records={[]}
              activeRecord={null}
              onClose={() => setActiveOverlay(null)}
            />
          ) : null}
        </DeferredLoadBoundary>
      ) : null}
      {!workspaceActive && toastActivated ? (
        <DeferredLoadBoundary resetKey="toaster">
          <DeferredToaster theme={theme} />
        </DeferredLoadBoundary>
      ) : null}
    </>
  );

  return (
    <TooltipProvider delay={600} closeDelay={0}>
      <div
        className="uq-shell"
        data-source-file={sourceView.streamedFileName ?? ""}
        data-parse-state={shellDataset.parseState}
        data-agent-session={shellDataset.agentSession}
        data-output-view={shellDataset.outputView}
        data-search-query={shellDataset.searchQuery}
        data-search-state={shellDataset.searchState}
        data-expanded-nested={shellDataset.expandedNested}
      >
        {workspaceActive ? (
          <DeferredLoadBoundary resetKey="workspace">
            <WorkspaceShellSlot
              fallback={shellChrome}
              workspaceProps={{
                onShellDatasetChange: handleShellDatasetChange,
                source,
                sourceView,
                readingFile,
                readingProgress,
                theme,
                onThemeChange: setTheme,
                activeOverlay,
                onActiveOverlayChange: handleActiveOverlayChange,
                onParseComplete: handleParseComplete,
                onSwitchView: handleSwitchView,
                pendingSampleExpansion,
                onConsumeSampleExpansion: handleConsumeSampleExpansion,
                pendingToolbarSearch,
                onConsumeToolbarSearch: handleConsumeToolbarSearch,
                onSourceChange: handleSourceChange,
                onFileDrop: handleFileDrop,
                emptyState,
                importPanel,
                changelogUrls,
                chromeWebStoreUrl,
                edgeAddonsUrl,
              }}
            />
          </DeferredLoadBoundary>
        ) : (
          shellChrome
        )}
      </div>
    </TooltipProvider>
  );
};
