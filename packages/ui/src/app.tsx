import type { JsonlRecord } from "@unquote/core";
import { formatResult } from "@unquote/core";
import { Chrome, PanelLeftOpen } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { InputPane } from "./components/input-pane";
import { LocaleToggle } from "./components/locale-toggle";
import { PathInspector } from "./components/path-inspector";
import type { PathInspectorSelection } from "./components/path-inspector";
import { PathJumpBar } from "./components/path-jump-bar";
import { RecordList } from "./components/record-list";
import { SearchBar } from "./components/search-bar";
import { StatusFooter } from "./components/status-footer";
import { ThemeToggle } from "./components/theme-toggle";
import { TocPane } from "./components/toc-pane";
import { Toolbar } from "./components/toolbar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/tabs";
import { useTranslation } from "./i18n/context";
import { useParser } from "./hooks/use-parser";
import {
  collectStringifiedPaths,
  hasJsonlRecords,
  materializeRecord,
  resolveTreePathMatches,
  searchRecords,
} from "./lib/tree";
import type { ResolvedTreePath, TreeRow } from "./lib/tree";

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

const readFileWithFileReader = (file: File, onProgress: (progress: number) => void) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(event.total === 0 ? 1 : event.loaded / event.total);
      }
    };
    reader.onload = () => {
      onProgress(1);
      resolve(typeof reader.result === "string" ? reader.result : "");
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsText(file);
  });

const readFileText = async (file: File, onProgress: (progress: number) => void) => {
  if (typeof file.stream !== "function") {
    if (typeof file.text === "function") {
      const text = await file.text();
      onProgress(1);
      return text;
    }

    return readFileWithFileReader(file, onProgress);
  }

  const reader = file.stream().getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytesRead = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    if (value) {
      bytesRead += value.byteLength;
      text += decoder.decode(value, { stream: true });
      onProgress(file.size === 0 ? 1 : bytesRead / file.size);
    }
  }

  text += decoder.decode();
  onProgress(1);
  return text;
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

export interface UnquoteAppProps {
  initialInput?: string;
  chromeWebStoreUrl?: string;
  onSourceChange?: (value: string) => void;
  onOpenFile?: () => Promise<string | null> | string | null | void;
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
  const [searchQuery, setSearchQuery] = useState("");
  const [searchRegex, setSearchRegex] = useState(false);
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
  const [searchJq, setSearchJq] = useState(false);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [pathQuery, setPathQuery] = useState("");
  const [pathError, setPathError] = useState<string | null>(null);
  const [pathMatches, setPathMatches] = useState<ResolvedTreePath[]>([]);
  const [currentPathMatchIndex, setCurrentPathMatchIndex] = useState(0);
  const [selectedPath, setSelectedPath] = useState<PathInspectorSelection | null>(null);
  const [scrollTarget, setScrollTarget] = useState<PathScrollTarget | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const fileImportIdRef = useRef(0);
  const scrollRequestIdRef = useRef(0);
  const { result, progress } = useParser(
    sourceText,
    mode === "auto" ? undefined : mode,
    sourceFile,
  );
  const detectedFormat = mode === "auto" ? result.format : mode;

  const matches = useMemo(() => {
    if (!searchQuery) return null;
    return searchRecords(result.records, searchQuery, {
      regex: searchRegex,
      caseSensitive: searchCaseSensitive,
      jq: searchJq,
    });
  }, [result.records, searchQuery, searchRegex, searchCaseSensitive, searchJq]);

  const matchCount = matches?.length ?? 0;

  useEffect(() => {
    setCurrentMatchIndex(0);
    setScrollTarget(null);
  }, [searchQuery, searchRegex, searchCaseSensitive, searchJq]);

  useEffect(() => {
    if (!matches || matches.length === 0) return;

    const pathsToExpand = new Set<string>();
    for (const match of matches) {
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
  }, [matches]);

  const activeMatch = useMemo(() => {
    if (!matches || matches.length === 0) return null;
    return {
      recordId: matches[currentMatchIndex]!.recordId,
      pathText: matches[currentMatchIndex]!.pathText,
    };
  }, [matches, currentMatchIndex]);

  const handlePrevMatch = () => {
    if (matchCount === 0) return;
    setScrollTarget(null);
    setCurrentMatchIndex((prev) => (prev - 1 + matchCount) % matchCount);
  };

  const handleNextMatch = () => {
    if (matchCount === 0) return;
    setScrollTarget(null);
    setCurrentMatchIndex((prev) => (prev + 1) % matchCount);
  };

  const scrollToPath = (recordId: string, pathText: string) => {
    scrollRequestIdRef.current += 1;
    setScrollTarget({ recordId, pathText, requestId: scrollRequestIdRef.current });
  };

  const handlePathQueryChange = (value: string) => {
    setPathQuery(value);
    setPathError(null);
    setPathMatches([]);
    setCurrentPathMatchIndex(0);
  };

  const applyPathTarget = (target: ResolvedTreePath, index: number) => {
    setPathError(null);
    setCurrentPathMatchIndex(index);
    setSelectedPath(createSelectionFromTarget(target));
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
  };

  const handlePathJump = () => {
    const resolved = resolveTreePathMatches(result.records, pathQuery);
    if (!resolved.ok) {
      setPathError(t(resolved.reason === "invalid" ? "path.invalid" : "path.notFound"));
      setPathMatches([]);
      setCurrentPathMatchIndex(0);
      return;
    }

    setPathMatches(resolved.targets);
    applyPathTarget(resolved.targets[0]!, 0);
  };

  const handlePrevPathMatch = () => {
    if (pathMatches.length === 0) return;
    const nextIndex = (currentPathMatchIndex - 1 + pathMatches.length) % pathMatches.length;
    applyPathTarget(pathMatches[nextIndex]!, nextIndex);
  };

  const handleNextPathMatch = () => {
    if (pathMatches.length === 0) return;
    const nextIndex = (currentPathMatchIndex + 1) % pathMatches.length;
    applyPathTarget(pathMatches[nextIndex]!, nextIndex);
  };

  useEffect(() => {
    onSourceChange?.(sourceText);
  }, [onSourceChange, sourceText]);

  useEffect(() => {
    const firstRecord = result.records[0];
    setActiveRecordId((current) => current ?? firstRecord?.id ?? null);
  }, [result.records]);

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
    setScrollTarget(null);
    setPathError(null);
    setPathMatches([]);
    setCurrentPathMatchIndex(0);
    if (value.length > largeSourceCollapseBytes) {
      setSourceCollapsed(true);
    }
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
      setScrollTarget(null);
      setPathError(null);
      setPathMatches([]);
      setCurrentPathMatchIndex(0);
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
    const text = await onOpenFile?.();
    if (typeof text === "string") {
      handleSourceChange(text);
    }
  };

  const handleCopyAll = async () => {
    await navigator.clipboard.writeText(formatResult(result));
  };

  const handleExpandAll = () => {
    const all = new Set<string>();
    result.records.forEach((record) => {
      collectStringifiedPaths(record, expandedStringifiedPaths, restoredRecordIds).forEach(
        (path) => {
          all.add(path);
        },
      );
    });
    setRestoredRecordIds(new Set());
    setExpandedStringifiedPaths(all);
  };

  const handleRestoreAll = () => {
    setExpandedStringifiedPaths(new Set());
    setRestoredRecordIds(
      new Set(result.records.filter((record) => record.node).map((record) => record.id)),
    );
    setSelectedPath(null);
    setScrollTarget(null);
    setPathMatches([]);
    setCurrentPathMatchIndex(0);
  };

  const handleTogglePath = (path: string) => {
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
    const value = materializeRecord(record, restoredRecordIds);
    await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
  };

  const handleCopyNode = async (_recordId: string, row: TreeRow) => {
    await navigator.clipboard.writeText(JSON.stringify(row.node.value, null, 2));
  };

  const handleSelectNode = (record: JsonlRecord, row: TreeRow) => {
    setSelectedPath(createSelectionFromRow(record, row));
    setActiveRecordId(record.id);
    scrollToPath(record.id, row.pathText);
  };

  const handleSelectRecord = (record: JsonlRecord) => {
    setActiveRecordId(record.id);
    const element = document.getElementById(record.id);
    element?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  useEffect(() => {
    if (!outputRef.current || result.records.length === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];

        if (visible?.target.id) {
          setActiveRecordId(visible.target.id);
        }
      },
      {
        root: null,
        threshold: [0.3, 0.6, 0.9],
      },
    );

    result.records.forEach((record) => {
      const element = document.getElementById(record.id);
      if (element) {
        observer.observe(element);
      }
    });

    return () => observer.disconnect();
  }, [result.records]);

  const statsLabel = t("stats.label", {
    total: result.stats.total,
    success: result.stats.success,
    failed: result.stats.failed,
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
  const output = (
    <div ref={outputRef} className="flex flex-col gap-3">
      <Toolbar
        onCopyAll={handleCopyAll}
        onExpandAll={handleExpandAll}
        onRestoreAll={handleRestoreAll}
        searchBar={
          <div className="grid min-w-0 gap-2 md:grid-cols-[minmax(220px,0.9fr)_minmax(260px,1fr)]">
            <PathJumpBar
              value={pathQuery}
              error={pathError}
              matchCount={pathMatches.length}
              currentIndex={currentPathMatchIndex}
              onChange={handlePathQueryChange}
              onSubmit={handlePathJump}
              onPrev={handlePrevPathMatch}
              onNext={handleNextPathMatch}
            />
            <SearchBar
              query={searchQuery}
              onQueryChange={setSearchQuery}
              regex={searchRegex}
              onRegexChange={setSearchRegex}
              caseSensitive={searchCaseSensitive}
              onCaseSensitiveChange={setSearchCaseSensitive}
              jq={searchJq}
              onJqChange={setSearchJq}
              matchCount={matchCount}
              currentIndex={currentMatchIndex}
              onPrev={handlePrevMatch}
              onNext={handleNextMatch}
            />
          </div>
        }
      />
      <RecordList
        records={result.records}
        expandedStringifiedPaths={expandedStringifiedPaths}
        restoredRecordIds={restoredRecordIds}
        searchMatches={matches ?? []}
        activeMatch={activeMatch}
        scrollTarget={scrollTarget}
        selectedPath={selectedPath}
        onTogglePath={handleTogglePath}
        onCopyRecord={handleCopyRecord}
        onCopyPath={(path) => navigator.clipboard.writeText(path)}
        onCopyNode={handleCopyNode}
        onSelectNode={handleSelectNode}
        onRestoreRecord={(recordId) => {
          setRestoredRecordIds((current) => new Set(current).add(recordId));
          if (selectedPath?.recordId === recordId) {
            setSelectedPath(null);
            setScrollTarget(null);
          }
        }}
        onHoverPath={(path) => setHoveredPath(path ?? "$")}
      />
    </div>
  );

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <header className="sticky top-0 z-30 flex h-11 items-center justify-between border-b border-border bg-[var(--background)]/80 px-4 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <span className="text-[15px] font-semibold tracking-tight text-text-primary">
            Unquote
          </span>
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
              onOpenFile={handleOpenFile}
              onFileDrop={handleFileDrop}
              onClear={() => handleSourceChange("")}
              onToggleCollapse={() => setSourceCollapsed((current) => !current)}
              sourceStatus={sourceFileStatus}
              sourceBusy={sourceFileBusy}
              sourceProgress={readingFile ? readProgress : null}
            />
          </TabsContent>
          <TabsContent value="output">{output}</TabsContent>
        </Tabs>

        <div
          className={`hidden items-start gap-3 lg:grid ${sourceCollapsed ? "lg:grid-cols-[76px_minmax(0,1fr)]" : "lg:grid-cols-[minmax(360px,420px)_minmax(0,1fr)] xl:grid-cols-[minmax(420px,520px)_minmax(0,1fr)]"}`}
        >
          <div
            className={`sticky top-11 flex flex-col gap-3 overflow-hidden ${
              selectedPath ? "max-h-[calc(100vh-9rem)]" : "max-h-[calc(100vh-5.75rem)]"
            }`}
          >
            <InputPane
              value={sourceText}
              mode={mode}
              onChange={handleSourceChange}
              onModeChange={setMode}
              onOpenFile={handleOpenFile}
              onFileDrop={handleFileDrop}
              onClear={() => handleSourceChange("")}
              onToggleCollapse={() => setSourceCollapsed((current) => !current)}
              collapsed={sourceCollapsed}
              sourceStatus={sourceFileStatus}
              sourceBusy={sourceFileBusy}
              sourceProgress={readingFile ? readProgress : null}
            />
            {sourceCollapsed ? (
              <button
                type="button"
                className="flex h-12 items-center justify-center gap-2 rounded-md border border-border bg-surface-100 text-xs font-medium text-text-secondary shadow-sm"
                onClick={() => setSourceCollapsed(false)}
              >
                <PanelLeftOpen className="size-4" />
                {t("app.expand")}
              </button>
            ) : hasJsonlRecords(result) ? (
              <TocPane
                result={result}
                activeRecordId={activeRecordId}
                onSelect={handleSelectRecord}
              />
            ) : null}
          </div>
          <div className="min-w-0">{output}</div>
        </div>
      </main>
      <StatusFooter
        detectedFormat={detectedFormat}
        statsLabel={progressLabel}
        pathLabel={hoveredPath}
        inspector={
          selectedPath ? (
            <PathInspector
              selection={selectedPath}
              onCopy={(value) => navigator.clipboard.writeText(value)}
              onClear={() => setSelectedPath(null)}
            />
          ) : null
        }
      />
    </div>
  );
};
