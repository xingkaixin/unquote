import type { JsonlRecord } from "@unquote/core";
import { formatResult } from "@unquote/core";
import { Chrome, PanelLeftOpen } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { InputPane } from "./components/input-pane";
import { LocaleToggle } from "./components/locale-toggle";
import { RecordList } from "./components/record-list";
import { SearchBar } from "./components/search-bar";
import { ThemeToggle } from "./components/theme-toggle";
import { TocPane } from "./components/toc-pane";
import { Toolbar } from "./components/toolbar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/tabs";
import { useTranslation } from "./i18n/context";
import { useParser } from "./hooks/use-parser";
import { collectStringifiedPaths, hasJsonlRecords, materializeRecord, searchRecords } from "./lib/tree";
import type { TreeRow } from "./lib/tree";

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
  const outputRef = useRef<HTMLDivElement>(null);
  const result = useParser(sourceText, mode === "auto" ? undefined : mode);
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
    setCurrentMatchIndex((prev) => (prev - 1 + matchCount) % matchCount);
  };

  const handleNextMatch = () => {
    if (matchCount === 0) return;
    setCurrentMatchIndex((prev) => (prev + 1) % matchCount);
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
    setSourceText(value);
    setRestoredRecordIds(new Set());
    setExpandedStringifiedPaths(new Set());
  };

  const handleFileDrop = async (file: File) => {
    const text = onReadFile ? await onReadFile(file) : await file.text();
    handleSourceChange(text);
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
  const output = (
    <div ref={outputRef} className="flex flex-col gap-3">
      <Toolbar
        detectedFormat={detectedFormat}
        pathLabel={hoveredPath}
        statsLabel={statsLabel}
        onCopyAll={handleCopyAll}
        onExpandAll={handleExpandAll}
        onRestoreAll={handleRestoreAll}
        searchBar={
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
        }
      />
      <RecordList
        records={result.records}
        expandedStringifiedPaths={expandedStringifiedPaths}
        restoredRecordIds={restoredRecordIds}
        searchMatches={matches ?? []}
        activeMatch={activeMatch}
        onTogglePath={handleTogglePath}
        onCopyRecord={handleCopyRecord}
        onCopyPath={(path) => navigator.clipboard.writeText(path)}
        onCopyNode={handleCopyNode}
        onRestoreRecord={(recordId) =>
          setRestoredRecordIds((current) => new Set(current).add(recordId))
        }
        onHoverPath={(path) => setHoveredPath(path ?? "$")}
      />
    </div>
  );

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-[var(--background)]/80 px-4 py-2 backdrop-blur-md">
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

      <main className="mx-auto flex w-full max-w-[1800px] flex-col gap-3 px-4 py-3 lg:px-6">
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
            />
          </TabsContent>
          <TabsContent value="output">{output}</TabsContent>
        </Tabs>

        <div
          className={`hidden items-start gap-3 lg:grid ${sourceCollapsed ? "lg:grid-cols-[76px_minmax(0,1fr)]" : "lg:grid-cols-[minmax(360px,420px)_minmax(0,1fr)] xl:grid-cols-[minmax(420px,520px)_minmax(0,1fr)]"}`}
        >
          <div className="sticky top-12 flex max-h-[calc(100vh-3.5rem)] flex-col gap-3 overflow-hidden">
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
    </div>
  );
};
