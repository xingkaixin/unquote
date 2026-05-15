import { parseJsonlRecordLine } from "@unquote/core";
import type { JsonlRecord } from "@unquote/core";
import { Chrome, PanelLeftOpen } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileOverview } from "./components/file-overview";
import { InputPane } from "./components/input-pane";
import type { SourceParseError } from "./components/input-pane";
import { LocaleToggle } from "./components/locale-toggle";
import { PathInspector } from "./components/path-inspector";
import type { PathInspectorSelection } from "./components/path-inspector";
import { PathJumpBar } from "./components/path-jump-bar";
import { RecordFilterBar } from "./components/record-filter-bar";
import { RecordList } from "./components/record-list";
import { SearchBar } from "./components/search-bar";
import { StatusFooter } from "./components/status-footer";
import { ThemeToggle } from "./components/theme-toggle";
import { TocPane } from "./components/toc-pane";
import { Toolbar } from "./components/toolbar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/tabs";
import { useTranslation } from "./i18n/context";
import { useParser } from "./hooks/use-parser";
import { createFileOverview } from "./lib/file-overview";
import type { FileOverviewCache } from "./lib/file-overview";
import {
  buildSearchPattern,
  collectStringifiedPaths,
  filterRecords,
  getRenderedRecord,
  hasJsonlRecords,
  materializeRecord,
  resolveTreePath,
  resolveTreePathMatches,
  searchRecord,
  searchRecords,
} from "./lib/tree";
import { sourceSamples } from "./lib/source-samples";
import type {
  RecordFilterMode,
  ResolvedTreePath,
  SearchMatch,
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

const getRecordStats = (records: JsonlRecord[]) => {
  const success = records.filter((record) => record.node).length;
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

const readJsonlFileLines = async (
  file: File,
  onLine: (line: string, lineNumber: number) => boolean | void,
  signal?: AbortSignal,
) => {
  let lineNumber = 1;
  let stopped = false;
  const processLine = (rawLine: string) => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    stopped = onLine(line, lineNumber) === false;
    lineNumber += 1;
  };

  if (typeof file.stream !== "function") {
    const text = await readFileText(file, () => undefined);
    for (const rawLine of text.split("\n")) {
      if (stopped || signal?.aborted) {
        break;
      }
      processLine(rawLine);
    }
    return;
  }

  const reader = file.stream().getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let readerCanceled = false;

  const cancelReader = () => {
    readerCanceled = true;
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", cancelReader, { once: true });

  try {
    while (!stopped && !signal?.aborted) {
      const { value, done } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        if (buffer && !signal?.aborted) {
          processLine(buffer);
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0 && !stopped && !signal?.aborted) {
        processLine(buffer.slice(0, newlineIndex));
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf("\n");
      }
    }
  } catch (error) {
    if (!signal?.aborted) {
      throw error;
    }
  } finally {
    signal?.removeEventListener("abort", cancelReader);
    if ((stopped || signal?.aborted) && !readerCanceled) {
      await reader.cancel().catch(() => undefined);
    }
  }
};

const readJsonlRecordsByLine = async (file: File, lineNumbers: Set<number>) => {
  const records = new Map<number, JsonlRecord>();
  if (lineNumbers.size === 0) {
    return records;
  }

  await readJsonlFileLines(file, (line, lineNumber) => {
    if (lineNumbers.has(lineNumber)) {
      records.set(lineNumber, parseJsonlRecordLine(line, lineNumber));
    }
    return records.size < lineNumbers.size;
  });

  return records;
};

const searchJsonlFile = async (
  file: File,
  query: string,
  options: SearchOptions,
  signal: AbortSignal,
): Promise<SearchMatch[] | null> => {
  const pattern = buildSearchPattern(query, options);
  if (!pattern) {
    return null;
  }

  const matches: SearchMatch[] = [];
  await readJsonlFileLines(
    file,
    (line, lineNumber) => {
      if (signal.aborted) {
        return false;
      }

      if (line.trim()) {
        matches.push(...searchRecord(parseJsonlRecordLine(line, lineNumber), pattern, options));
      }
    },
    signal,
  );

  return signal.aborted ? null : matches;
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
  const [fileSearchMatches, setFileSearchMatches] = useState<SearchMatch[] | null>(null);
  const [recordFilter, setRecordFilter] = useState<RecordFilterMode>("all");
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [pathQuery, setPathQuery] = useState("");
  const [pathError, setPathError] = useState<string | null>(null);
  const [pathMatches, setPathMatches] = useState<ResolvedTreePath[]>([]);
  const [currentPathMatchIndex, setCurrentPathMatchIndex] = useState(0);
  const [selectedPath, setSelectedPath] = useState<PathInspectorSelection | null>(null);
  const [scrollTarget, setScrollTarget] = useState<PathScrollTarget | null>(null);
  const [recordScrollTarget, setRecordScrollTarget] = useState<{
    recordId: string;
    requestId: number;
  } | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const overviewCacheRef = useRef<FileOverviewCache>(new Map());
  const fileImportIdRef = useRef(0);
  const scrollRequestIdRef = useRef(0);
  const { result, progress } = useParser(
    sourceText,
    mode === "auto" ? undefined : mode,
    sourceFile,
  );
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

  const inMemoryMatches = useMemo(() => {
    if (!searchQuery || sourceFile) return null;
    return searchRecords(result.records, searchQuery, searchOptions);
  }, [result.records, searchOptions, searchQuery, sourceFile]);

  useEffect(() => {
    if (!sourceFile || !searchQuery) {
      setFileSearchMatches(null);
      return;
    }

    const controller = new AbortController();
    setFileSearchMatches(null);
    void searchJsonlFile(sourceFile, searchQuery, searchOptions, controller.signal)
      .then((nextMatches) => {
        if (!controller.signal.aborted) {
          setFileSearchMatches(nextMatches);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setFileSearchMatches(null);
        }
      });

    return () => controller.abort();
  }, [searchOptions, searchQuery, sourceFile]);

  const matches = sourceFile && searchQuery ? fileSearchMatches : inMemoryMatches;

  const visibleRecords = useMemo(
    () => filterRecords(result.records, recordFilter, matches),
    [matches, recordFilter, result.records],
  );
  const visibleStats = useMemo(() => getRecordStats(visibleRecords), [visibleRecords]);
  const fileOverview = useMemo(
    () => createFileOverview(result.records, overviewCacheRef.current),
    [result.records],
  );
  const visibleMatches = useMemo(() => {
    if (!matches) return null;

    const visibleRecordIds = new Set(visibleRecords.map((record) => record.id));
    return matches.filter((match) => visibleRecordIds.has(match.recordId));
  }, [matches, visibleRecords]);
  const matchCount = visibleMatches?.length ?? 0;

  useEffect(() => {
    setCurrentMatchIndex(0);
    setScrollTarget(null);
  }, [recordFilter, searchQuery, searchRegex, searchCaseSensitive, searchJq]);

  useEffect(() => {
    setPathError(null);
    setPathMatches([]);
    setCurrentPathMatchIndex(0);
  }, [recordFilter]);

  useEffect(() => {
    setCurrentMatchIndex((current) => (matchCount === 0 ? 0 : Math.min(current, matchCount - 1)));
  }, [matchCount]);

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
    const resolved = resolveTreePathMatches(visibleRecords, pathQuery);
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

  const handleOverviewPathSelect = (pathText: string) => {
    setPathQuery(pathText);
    setRecordFilter("all");
    const resolved = resolveTreePathMatches(result.records, pathText);
    if (!resolved.ok) {
      setPathError(t(resolved.reason === "invalid" ? "path.invalid" : "path.notFound"));
      setPathMatches([]);
      setCurrentPathMatchIndex(0);
      return;
    }

    setPathMatches(resolved.targets);
    applyPathTarget(resolved.targets[0]!, 0);
  };

  const handleOverviewFieldValueSearch = (value: string) => {
    setSearchQuery(value);
    setSearchRegex(false);
    setSearchCaseSensitive(false);
    setSearchJq(false);
    setRecordFilter("matches");
    setCurrentMatchIndex(0);
    setScrollTarget(null);
  };

  useEffect(() => {
    onSourceChange?.(sourceText);
  }, [onSourceChange, sourceText]);

  useEffect(() => {
    const visibleRecordIds = new Set(visibleRecords.map((record) => record.id));
    const firstRecord = visibleRecords[0];
    setActiveRecordId((current) =>
      current && visibleRecordIds.has(current) ? current : (firstRecord?.id ?? null),
    );
  }, [visibleRecords]);

  useEffect(() => {
    const visibleRecordIds = new Set(visibleRecords.map((record) => record.id));
    if (selectedPath && !visibleRecordIds.has(selectedPath.recordId)) {
      setSelectedPath(null);
    }
    if (scrollTarget && !visibleRecordIds.has(scrollTarget.recordId)) {
      setScrollTarget(null);
    }
    if (recordScrollTarget && !visibleRecordIds.has(recordScrollTarget.recordId)) {
      setRecordScrollTarget(null);
    }
  }, [recordScrollTarget, scrollTarget, selectedPath, visibleRecords]);

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
    setRecordScrollTarget(null);
    setPathError(null);
    setPathMatches([]);
    setCurrentPathMatchIndex(0);
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
      setScrollTarget(null);
      setRecordScrollTarget(null);
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
    const source = await onOpenFile?.();
    if (source instanceof File) {
      await handleFileDrop(source);
      return;
    }

    if (typeof source === "string") {
      handleSourceChange(source);
    }
  };

  const getRecordsForCopy = async (records: JsonlRecord[]) => {
    if (!sourceFile) {
      return records;
    }

    const fullRecords = await readJsonlRecordsByLine(
      sourceFile,
      new Set(records.map((record) => record.lineNumber)),
    );
    return records.map((record) => fullRecords.get(record.lineNumber) ?? record);
  };

  const handleCopyJsonl = async () => {
    const records = await getRecordsForCopy(visibleRecords);
    await navigator.clipboard.writeText(formatRecordsAsJsonl(records, restoredRecordIds));
  };

  const handleCopyFormattedJson = async () => {
    const records = await getRecordsForCopy(visibleRecords);
    await navigator.clipboard.writeText(
      formatRecordsAsJson(records, restoredRecordIds, result.format),
    );
  };

  const handleExpandAll = () => {
    const all = new Set<string>();
    visibleRecords.forEach((record) => {
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
    const [copyRecord = record] = await getRecordsForCopy([record]);
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
    const [copyRecord] = record ? await getRecordsForCopy([record]) : [];
    const renderedRecord = copyRecord ? getRenderedRecord(copyRecord, restoredRecordIds) : null;
    const resolved = renderedRecord?.node ? resolveTreePath([renderedRecord], row.pathText) : null;
    const value = resolved?.ok ? resolved.target.node.value : row.node.value;
    await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
  };

  const handleSelectNode = (record: JsonlRecord, row: TreeRow) => {
    setSelectedPath(createSelectionFromRow(record, row));
    setActiveRecordId(record.id);
    scrollToPath(record.id, row.pathText);
  };

  const handleSelectRecord = (record: JsonlRecord) => {
    setActiveRecordId(record.id);
    scrollRequestIdRef.current += 1;
    setRecordScrollTarget({ recordId: record.id, requestId: scrollRequestIdRef.current });
  };

  const handleOverviewErrorSelect = (recordId: string) => {
    const record = result.records.find((candidate) => candidate.id === recordId);
    if (!record) {
      return;
    }

    setRecordFilter("errors");
    handleSelectRecord(record);
  };

  const handleActiveRecordChange = useCallback((recordId: string) => {
    setActiveRecordId((current) => (current === recordId ? current : recordId));
  }, []);

  useEffect(() => {
    if (!outputRef.current || visibleRecords.length === 0) {
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

    visibleRecords.forEach((record) => {
      const element = document.getElementById(record.id);
      if (element) {
        observer.observe(element);
      }
    });

    return () => observer.disconnect();
  }, [visibleRecords]);

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
  const output = (
    <div ref={outputRef} className="flex flex-col gap-3">
      <Toolbar
        onCopyJsonl={handleCopyJsonl}
        onCopyFormattedJson={handleCopyFormattedJson}
        onExpandAll={handleExpandAll}
        onRestoreAll={handleRestoreAll}
        searchBar={
          <div className="flex min-w-0 flex-wrap gap-2">
            <div className="min-w-[200px] flex-[1_1_240px]">
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
            </div>
            <div className="min-w-[240px] flex-[1_1_300px]">
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
            <div className="min-w-[280px] flex-[1_1_340px]">
              <RecordFilterBar
                mode={recordFilter}
                visibleCount={visibleStats.total}
                totalCount={result.stats.total}
                onModeChange={setRecordFilter}
              />
            </div>
          </div>
        }
      />
      {fileOverview.total > 0 ? (
        <FileOverview
          overview={fileOverview}
          format={result.format}
          visibleCount={visibleStats.total}
          onSelectNestedPath={handleOverviewPathSelect}
          onSearchFieldValue={handleOverviewFieldValueSearch}
          onSelectError={handleOverviewErrorSelect}
        />
      ) : null}
      <RecordList
        records={visibleRecords}
        expandedStringifiedPaths={expandedStringifiedPaths}
        restoredRecordIds={restoredRecordIds}
        searchMatches={visibleMatches ?? []}
        activeMatch={activeMatch}
        scrollTarget={scrollTarget}
        recordScrollTarget={recordScrollTarget}
        selectedPath={selectedPath}
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
        }}
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
              sampleOptions={sampleOptions}
              onSampleSelect={handleSampleSelect}
              onOpenFile={handleOpenFile}
              onFileDrop={handleFileDrop}
              onClear={() => handleSourceChange("")}
              onToggleCollapse={() => setSourceCollapsed((current) => !current)}
              collapsed={sourceCollapsed}
              sourceStatus={sourceFileStatus}
              sourceBusy={sourceFileBusy}
              sourceProgress={readingFile ? readProgress : null}
              sourceError={sourceParseError}
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
                records={visibleRecords}
                totalCount={result.stats.total}
                activeRecordId={activeRecordId}
                onSelect={handleSelectRecord}
                onCopyRawLine={handleCopyRawLine}
              />
            ) : null}
          </div>
          <div className="min-w-0">{output}</div>
        </div>
      </main>
      <StatusFooter
        detectedFormat={detectedFormat}
        statsLabel={progressLabel}
        modeLabel={parseModeLabel}
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
