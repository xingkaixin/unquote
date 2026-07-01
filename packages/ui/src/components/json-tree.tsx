import type { JsonlRecord } from "@unquote/core";
import { ChevronRight, Copy, FileWarning, Focus, Undo2 } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "../i18n/context";
import { measurePerfFn } from "../lib/perf";
import type { RecordInsight } from "../lib/record-insight";
import { buildRecordRows } from "../lib/tree";
import type { SearchMatch, TextRange, TreeRow } from "../lib/tree";
import { Badge } from "./badge";
import { Button } from "./button";
import { Card, CardContent } from "./card";
import { RecordInsightSummary } from "./record-insight";

// A record only virtualizes past a row count and when every row is short and
// single-line: tall (long or multiline) values break the virtualizer's
// fixed-size row estimate.
const virtualizationRowThreshold = 180;
const inlineValueLengthLimit = 160;

interface JsonTreeProps {
  record: JsonlRecord;
  insight: RecordInsight | undefined;
  expandedStringifiedPaths: Set<string>;
  eager?: boolean;
  searchMatches: SearchMatch[];
  activeMatch: { recordId: string; pathText: string } | null;
  scrollTarget: { recordId: string; pathText: string; requestId: number } | null;
  selectedPath: { recordId: string; pathText: string } | null;
  focusedPath: { recordId: string; pathText: string } | null;
  onTogglePath: (path: string) => void;
  onCopyRecord: () => void;
  onCopyRawLine: () => void;
  onCopyError: () => void;
  onSelectNode: (row: TreeRow) => void;
  onHydrateRecord: (record: JsonlRecord) => void;
  onClearFocus: () => void;
}

export const JsonTree = ({
  record,
  insight,
  expandedStringifiedPaths,
  eager = false,
  searchMatches,
  activeMatch,
  scrollTarget,
  selectedPath,
  focusedPath,
  onTogglePath,
  onCopyRecord,
  onCopyRawLine,
  onCopyError,
  onSelectNode,
  onHydrateRecord,
  onClearFocus,
}: JsonTreeProps) => {
  const { t } = useTranslation();
  const cardRef = useRef<HTMLDivElement>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const [hydrated, setHydrated] = useState(eager);
  const focusedPathText = focusedPath?.recordId === record.id ? focusedPath.pathText : null;
  const rows = useMemo(
    () =>
      hydrated
        ? measurePerfFn("recordRows:build", () =>
            buildRecordRows(record, expandedStringifiedPaths, focusedPathText),
          )
        : [],
    [expandedStringifiedPaths, focusedPathText, hydrated, record],
  );
  const displayRows = useMemo(() => buildDisplayRows(rows), [rows]);

  useEffect(() => {
    if (record.deferred && hydrated) {
      onHydrateRecord(record);
    }
  }, [hydrated, onHydrateRecord, record]);
  const searchMatchMap = useMemo(() => {
    const map = new Map<string, SearchMatch>();
    for (const match of searchMatches) {
      map.set(match.pathText, match);
    }
    return map;
  }, [searchMatches]);

  const shouldVirtualize =
    displayRows.length > virtualizationRowThreshold &&
    displayRows.every(
      (row) => row.valueText.length < inlineValueLengthLimit && !row.valueText.includes("\\n"),
    );
  const rowVirtualizer = useVirtualizer({
    count: displayRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 38,
    overscan: 12,
    measureElement: (element) => element?.getBoundingClientRect().height ?? 38,
    enabled: shouldVirtualize,
  });

  useEffect(() => {
    if (hydrated) {
      return;
    }

    const element = cardRef.current;
    if (!element) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setHydrated(true);
          observer.disconnect();
        }
      },
      { rootMargin: "900px 0px" },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [hydrated]);

  useEffect(() => {
    const target = scrollTarget ?? activeMatch;
    if (!target || target.recordId !== record.id) {
      return;
    }
    if (!hydrated) {
      setHydrated(true);
      return;
    }

    const index = displayRows.findIndex(
      (row) => row.source.pathText === target.pathText && row.kind !== "close",
    );
    if (index === -1) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      if (shouldVirtualize) {
        rowVirtualizer.scrollToIndex(index, { align: "center" });
      } else {
        const element = document.getElementById(displayRows[index]!.id);
        element?.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [
    activeMatch,
    scrollTarget,
    record.id,
    displayRows,
    hydrated,
    shouldVirtualize,
    rowVirtualizer,
  ]);

  if (!record.node) {
    const errorMeta = record.errorMeta;
    const rawLine = record.rawLine ?? errorMeta?.rawLine ?? record.summary;
    return (
      <Card id={record.id} className="min-h-[120px] overflow-hidden">
        <div className="flex flex-col gap-2 border-b border-border px-4 py-[11px] sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <span className="font-mono text-[11px] text-text-secondary">#{record.lineNumber}</span>
            <span className="nf-led is-red" />
            <Badge variant="danger">{t("error.parseFailed")}</Badge>
            <span className="min-w-0 truncate text-[11px] text-text-secondary">
              {record.summary}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={onCopyRawLine}
            >
              <Copy className="size-3" />
              {t("error.copyRawLine")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={onCopyError}
            >
              <Copy className="size-3" />
              {t("error.copyDetails")}
            </Button>
          </div>
        </div>
        <CardContent className="flex flex-col gap-2 bg-surface-50 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="danger">
              <FileWarning className="mr-1 size-3" />
              {t("error.parseFailed")}
            </Badge>
            {errorMeta ? (
              <Badge>
                {t("error.location", { line: errorMeta.line, column: errorMeta.column })}
              </Badge>
            ) : null}
          </div>
          <div className="min-w-0 break-words font-mono text-[11px] leading-5 text-text-secondary">
            {record.error ?? t("error.parseFailed")}
          </div>
          {errorMeta ? (
            <div className="flex flex-col gap-1.5">
              <div className="text-[10px] font-medium uppercase tracking-wide text-text-muted">
                {t("error.rawLine")}
              </div>
              <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all border border-border bg-surface-100 px-2 py-1.5 font-mono text-[10px] leading-5 text-text-secondary">
                {rawLine}
              </pre>
              <div className="text-[10px] font-medium uppercase tracking-wide text-text-muted">
                {t("error.context")}
              </div>
              <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-all border border-border bg-surface-100 px-2 py-1.5 font-mono text-[10px] leading-5 text-text-secondary">
                {errorMeta.context}
              </pre>
            </div>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      ref={cardRef}
      id={record.id}
      className="scroll-mt-28 overflow-hidden [contain-intrinsic-size:480px] [content-visibility:auto]"
    >
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-[11px]">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="shrink-0 font-mono text-[11px] text-text-secondary">
              #{record.lineNumber}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="nf-led is-green is-static" />
              <Badge variant="success">ok</Badge>
            </span>
            <span className="min-w-0 truncate text-[13px] text-text-primary">
              {insight?.title ?? record.summary}
            </span>
            <span className="shrink-0 font-mono text-[10px] text-text-muted">
              {t("tree.nodes", { count: rows.length })}
            </span>
            {focusedPathText ? (
              <span className="inline-flex min-w-0 items-center gap-1 border border-accent bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] text-accent">
                <Focus className="size-3 shrink-0" />
                <span className="truncate">{t("tree.focused", { path: focusedPathText })}</span>
              </span>
            ) : null}
          </div>
          {insight ? <RecordInsightSummary insight={insight} /> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {focusedPathText ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={onClearFocus}
            >
              <Undo2 className="size-3.5" />
              {t("tree.exitFocus")}
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" className="h-7 w-7 px-0" onClick={onCopyRecord}>
            <Copy className="size-3.5" />
          </Button>
        </div>
      </div>
      <div ref={parentRef} className="max-h-[560px] overflow-auto bg-surface-50 py-2">
        {!hydrated ? (
          <div className="flex h-[200px] items-center justify-center px-6 font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
            {t("tree.scrollHint")}
          </div>
        ) : null}
        {hydrated && shouldVirtualize ? (
          <div className="relative w-full" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = displayRows[virtualRow.index];
              if (!row) {
                return null;
              }

              const searchMatch =
                row.kind === "close" ? undefined : searchMatchMap.get(row.source.pathText);
              const isActive =
                row.kind !== "close" && activeMatch?.pathText === row.source.pathText;
              const isSelected = selectedPath
                ? isPathInSelection(row.source.pathText, selectedPath.pathText)
                : false;
              const isSelectedAnchor = selectedPath?.pathText === row.source.pathText;

              return (
                <RowItem
                  key={row.id}
                  row={row}
                  virtualized
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                  measureRef={(node) => {
                    if (node) {
                      rowVirtualizer.measureElement(node);
                    }
                  }}
                  searchMatch={searchMatch}
                  isActiveMatch={isActive}
                  isSelected={isSelected}
                  isSelectedAnchor={isSelectedAnchor}
                  onTogglePath={(path) => {
                    if (record.deferred) {
                      onHydrateRecord(record);
                    }
                    onTogglePath(path);
                  }}
                  onSelectNode={onSelectNode}
                />
              );
            })}
          </div>
        ) : hydrated ? (
          <div>
            {displayRows.map((row) => {
              const searchMatch =
                row.kind === "close" ? undefined : searchMatchMap.get(row.source.pathText);
              const isActive =
                row.kind !== "close" && activeMatch?.pathText === row.source.pathText;
              const isSelected = selectedPath
                ? isPathInSelection(row.source.pathText, selectedPath.pathText)
                : false;
              const isSelectedAnchor = selectedPath?.pathText === row.source.pathText;
              return (
                <RowItem
                  key={row.id}
                  row={row}
                  searchMatch={searchMatch}
                  isActiveMatch={isActive}
                  isSelected={isSelected}
                  isSelectedAnchor={isSelectedAnchor}
                  onTogglePath={(path) => {
                    if (record.deferred) {
                      onHydrateRecord(record);
                    }
                    onTogglePath(path);
                  }}
                  onSelectNode={onSelectNode}
                />
              );
            })}
          </div>
        ) : null}
      </div>
    </Card>
  );
};

interface HighlightTextProps {
  text: string;
  ranges: TextRange[];
  isActive: boolean;
}

const HighlightText = ({ text, ranges, isActive }: HighlightTextProps) => {
  if (ranges.length === 0) return <>{text}</>;

  const segments: React.ReactNode[] = [];
  let lastEnd = 0;

  for (const range of ranges) {
    if (range.start > lastEnd) {
      segments.push(<span key={`pre-${lastEnd}`}>{text.slice(lastEnd, range.start)}</span>);
    }
    segments.push(
      <mark
        key={`mark-${range.start}`}
        className={
          isActive ? "bg-accent/45 font-medium ring-1 ring-accent/70" : "bg-accent/25 font-medium"
        }
      >
        {text.slice(range.start, range.end)}
      </mark>,
    );
    lastEnd = range.end;
  }

  if (lastEnd < text.length) {
    segments.push(<span key={`post-${lastEnd}`}>{text.slice(lastEnd)}</span>);
  }

  return <>{segments}</>;
};

const clampRanges = (ranges: TextRange[], textLength: number) =>
  ranges.flatMap((range) =>
    range.start < textLength ? [{ start: range.start, end: Math.min(range.end, textLength) }] : [],
  );

type DisplayRowKind = "value" | "open" | "close" | "empty" | "collapsed";

interface DisplayTreeRow {
  id: string;
  source: TreeRow;
  kind: DisplayRowKind;
  depth: number;
  keyLabel: string | null;
  valueText: string;
  comma: boolean;
  showToggle: boolean;
}

const isContainer = (row: TreeRow) => row.kind === "object" || row.kind === "array";

const isArrayElementPath = (pathText: string) => /\[\d+\]$/.test(pathText);

const getDisplayKeyLabel = (row: TreeRow) => {
  if (row.pathText === "$" || isArrayElementPath(row.pathText)) {
    return null;
  }

  return row.keyLabel;
};

const getContainerOpen = (row: TreeRow) => (row.kind === "array" ? "[" : "{");

const getContainerClose = (row: TreeRow) => (row.kind === "array" ? "]" : "}");

const getEmptyContainer = (row: TreeRow) => (row.kind === "array" ? "[]" : "{}");

const getCollapsedValue = (row: TreeRow) => {
  const rawString = row.node.rawString;
  if (typeof rawString === "string") {
    return JSON.stringify(rawString);
  }

  return row.valueLabel;
};

const buildDisplayRows = (rows: TreeRow[]): DisplayTreeRow[] => {
  const displayRows: DisplayTreeRow[] = [];
  const openStack: TreeRow[] = [];

  const closeUntilSiblingScope = (currentDepth: number) => {
    while (openStack.length > 0 && openStack[openStack.length - 1]!.depth >= currentDepth) {
      const source = openStack.pop()!;
      displayRows.push({
        id: `${source.id}:close`,
        source,
        kind: "close",
        depth: source.depth,
        keyLabel: null,
        valueText: getContainerClose(source),
        comma: source.depth === currentDepth,
        showToggle: false,
      });
    }
  };

  rows.forEach((row, index) => {
    closeUntilSiblingScope(row.depth);

    const nextRow = rows[index + 1];
    const hasVisibleChildren = isContainer(row) && row.expanded && nextRow?.depth === row.depth + 1;
    const comma = nextRow?.depth === row.depth;

    if (hasVisibleChildren) {
      displayRows.push({
        id: row.id,
        source: row,
        kind: "open",
        depth: row.depth,
        keyLabel: getDisplayKeyLabel(row),
        valueText: getContainerOpen(row),
        comma: false,
        showToggle: row.wasStringified,
      });
      openStack.push(row);
      return;
    }

    if (isContainer(row) && row.wasStringified && !row.expanded) {
      displayRows.push({
        id: row.id,
        source: row,
        kind: "collapsed",
        depth: row.depth,
        keyLabel: getDisplayKeyLabel(row),
        valueText: getCollapsedValue(row),
        comma,
        showToggle: true,
      });
      return;
    }

    if (isContainer(row)) {
      displayRows.push({
        id: row.id,
        source: row,
        kind: "empty",
        depth: row.depth,
        keyLabel: getDisplayKeyLabel(row),
        valueText: getEmptyContainer(row),
        comma,
        showToggle: row.wasStringified,
      });
      return;
    }

    displayRows.push({
      id: row.id,
      source: row,
      kind: "value",
      depth: row.depth,
      keyLabel: getDisplayKeyLabel(row),
      valueText: row.valueLabel,
      comma,
      showToggle: false,
    });
  });

  while (openStack.length > 0) {
    const source = openStack.pop()!;
    displayRows.push({
      id: `${source.id}:close`,
      source,
      kind: "close",
      depth: source.depth,
      keyLabel: null,
      valueText: getContainerClose(source),
      comma: false,
      showToggle: false,
    });
  }

  return displayRows;
};

const isPathInSelection = (pathText: string, selectedPath: string) =>
  pathText === selectedPath ||
  pathText.startsWith(`${selectedPath}.`) ||
  pathText.startsWith(`${selectedPath}[`);

interface RowItemProps {
  row: DisplayTreeRow;
  searchMatch?: SearchMatch | undefined;
  isActiveMatch: boolean;
  isSelected: boolean;
  isSelectedAnchor: boolean;
  onTogglePath: (path: string) => void;
  onSelectNode: (row: TreeRow) => void;
  virtualized?: boolean;
  style?: CSSProperties;
  measureRef?: (node: HTMLDivElement | null) => void;
}

const RowItem = ({
  row,
  searchMatch,
  isActiveMatch,
  isSelected,
  isSelectedAnchor,
  onTogglePath,
  onSelectNode,
  virtualized = false,
  style,
  measureRef,
}: RowItemProps) => {
  const { t } = useTranslation();
  const source = row.source;
  const valueRanges =
    row.kind === "value" && searchMatch?.valueRanges.length
      ? clampRanges(searchMatch.valueRanges, row.valueText.length)
      : [];
  const rowTone = isSelected
    ? "bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)]"
    : isActiveMatch
      ? "bg-[color-mix(in_srgb,var(--color-accent)_20%,transparent)] shadow-[inset_2px_0_0_var(--color-accent)]"
      : searchMatch
        ? "bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)]"
        : "hover:bg-surface-100";
  const anchorTone = isSelectedAnchor ? "shadow-[inset_2px_0_0_var(--color-accent)]" : "";

  return (
    <div
      ref={measureRef}
      id={row.id}
      className={`group ${virtualized ? "absolute left-0 top-0" : ""} flex w-full cursor-pointer items-start px-3 ${rowTone} ${anchorTone}`}
      style={style}
      onClick={() => onSelectNode(source)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelectNode(source);
        }
      }}
      role="button"
      tabIndex={0}
    >
      <span style={{ width: `${row.depth * 16}px` }} className="shrink-0" />
      <div className="flex min-w-0 flex-1 items-start py-0.5">
        {row.showToggle ? (
          <button
            type="button"
            className="mr-1.5 mt-[3px] inline-flex size-[15px] shrink-0 items-center justify-center border border-accent bg-accent/10 text-accent"
            onClick={(event) => {
              event.stopPropagation();
              onTogglePath(source.pathText);
            }}
            aria-label={t("tree.toggle", { key: source.keyLabel })}
          >
            <ChevronRight
              className={`size-2.5 transition-transform ${source.expanded ? "rotate-90" : ""}`}
            />
          </button>
        ) : (
          <span className="w-[21px] shrink-0" />
        )}
        {row.keyLabel ? (
          <>
            <span className="font-mono text-[11.5px] leading-[1.85] text-code-key">"</span>
            <span className="break-all font-mono text-[11.5px] leading-[1.85] text-code-key">
              {searchMatch?.keyRanges.length ? (
                <HighlightText
                  text={row.keyLabel}
                  ranges={searchMatch.keyRanges}
                  isActive={isActiveMatch}
                />
              ) : searchMatch?.pathRanges.length ? (
                <HighlightText
                  text={row.keyLabel}
                  ranges={[{ start: 0, end: row.keyLabel.length }]}
                  isActive={isActiveMatch}
                />
              ) : (
                row.keyLabel
              )}
            </span>
            <span className="font-mono text-[11.5px] leading-[1.85] text-code-key">"</span>
            <span className="pr-1 font-mono text-[11.5px] leading-[1.85] text-text-secondary">
              :
            </span>
          </>
        ) : null}
        <span
          className={`min-w-0 break-all whitespace-pre-wrap font-mono text-[11.5px] leading-[1.85] ${getDisplayValueClassName(row)}`}
        >
          {valueRanges.length ? (
            <HighlightText text={row.valueText} ranges={valueRanges} isActive={isActiveMatch} />
          ) : (
            row.valueText
          )}
        </span>
        {row.comma ? (
          <span className="font-mono text-[11.5px] leading-[1.85] text-text-secondary">,</span>
        ) : null}
      </div>
    </div>
  );
};

const getDisplayValueClassName = (row: DisplayTreeRow) => {
  if (row.kind === "open" || row.kind === "close" || row.kind === "empty") {
    return "text-text-secondary";
  }

  if (row.kind === "collapsed") {
    return "text-code-string";
  }

  return getValueClassName(row.source);
};

const getValueClassName = (row: TreeRow) => {
  switch (row.kind) {
    case "string":
      return "text-code-string";
    case "number":
      return "text-code-number";
    case "boolean":
      return "text-code-boolean";
    case "null":
      return "text-code-null";
    case "object":
    case "array":
      return "text-text-tertiary";
    default:
      return "text-text-secondary";
  }
};
