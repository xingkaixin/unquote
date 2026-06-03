import type { JsonlRecord } from "@unquote/core";
import { ChevronRight, Copy, FileWarning, Focus, RotateCcw, Sparkles, Undo2 } from "lucide-react";
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

interface JsonTreeProps {
  record: JsonlRecord;
  insight: RecordInsight | undefined;
  expandedStringifiedPaths: Set<string>;
  restoredRecordIds: Set<string>;
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
  onCopyPath: (path: string) => void;
  onCopyNode: (row: TreeRow) => void;
  onSelectNode: (row: TreeRow) => void;
  onRestoreRecord: () => void;
  onHydrateRecord: (record: JsonlRecord) => void;
  onClearFocus: () => void;
  onHoverPath: (path: string | null) => void;
}

export const JsonTree = ({
  record,
  insight,
  expandedStringifiedPaths,
  restoredRecordIds,
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
  onCopyPath,
  onCopyNode,
  onSelectNode,
  onRestoreRecord,
  onHydrateRecord,
  onClearFocus,
  onHoverPath,
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
            buildRecordRows(record, expandedStringifiedPaths, restoredRecordIds, focusedPathText),
          )
        : [],
    [expandedStringifiedPaths, focusedPathText, hydrated, record, restoredRecordIds],
  );

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
    rows.length > 160 &&
    rows.every((row) => row.valueLabel.length < 160 && !row.valueLabel.includes("\\n"));
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
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

    const index = rows.findIndex((row) => row.pathText === target.pathText);
    if (index === -1) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      if (shouldVirtualize) {
        rowVirtualizer.scrollToIndex(index, { align: "center" });
      } else {
        const element = document.getElementById(rows[index]!.id);
        element?.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [activeMatch, scrollTarget, record.id, hydrated, rows, shouldVirtualize, rowVirtualizer]);

  if (!record.node) {
    const errorMeta = record.errorMeta;
    const rawLine = record.rawLine ?? errorMeta?.rawLine ?? record.summary;
    return (
      <Card id={record.id} className="min-h-[120px] overflow-hidden">
        <div className="flex flex-col gap-2 border-b border-border px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <span className="font-mono text-[11px] text-text-secondary">#{record.lineNumber}</span>
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
        <CardContent className="flex flex-col gap-2 py-3">
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
              <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-surface-50 px-2 py-1.5 font-mono text-[10px] leading-5 text-text-secondary">
                {rawLine}
              </pre>
              <div className="text-[10px] font-medium uppercase tracking-wide text-text-muted">
                {t("error.context")}
              </div>
              <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-surface-50 px-2 py-1.5 font-mono text-[10px] leading-5 text-text-secondary">
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
      className="scroll-mt-24 overflow-hidden [contain-intrinsic-size:480px] [content-visibility:auto]"
    >
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="shrink-0 font-mono text-[11px] text-text-secondary">
              #{record.lineNumber}
            </span>
            <span className="min-w-0 truncate text-[11px] text-text-secondary">
              {insight?.title ?? record.summary}
            </span>
            <span className="shrink-0 font-mono text-[10px] text-text-muted">
              {t("tree.nodes", { count: rows.length })}
            </span>
            {focusedPathText ? (
              <span className="inline-flex min-w-0 items-center gap-1 rounded-md border border-accent/30 bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] text-accent">
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
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 px-0"
            onClick={() => {
              if (record.deferred) {
                onHydrateRecord(record);
              }
              onRestoreRecord();
            }}
          >
            <RotateCcw className="size-3.5" />
          </Button>
        </div>
      </div>
      <div ref={parentRef} className="max-h-[560px] overflow-auto bg-surface-50">
        {!hydrated ? (
          <div className="flex h-[200px] items-center justify-center px-6 text-[11px] text-text-muted">
            {t("tree.scrollHint")}
          </div>
        ) : null}
        {hydrated && shouldVirtualize ? (
          <div className="relative w-full" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];
              if (!row) {
                return null;
              }

              const searchMatch = searchMatchMap.get(row.pathText);
              const isActive = activeMatch?.pathText === row.pathText;
              const isSelected = selectedPath?.pathText === row.pathText;

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
                  onTogglePath={(path) => {
                    if (record.deferred) {
                      onHydrateRecord(record);
                    }
                    onTogglePath(path);
                  }}
                  onCopyPath={onCopyPath}
                  onCopyNode={onCopyNode}
                  onSelectNode={onSelectNode}
                  onHoverPath={onHoverPath}
                />
              );
            })}
          </div>
        ) : hydrated ? (
          <div>
            {rows.map((row) => {
              const searchMatch = searchMatchMap.get(row.pathText);
              const isActive = activeMatch?.pathText === row.pathText;
              const isSelected = selectedPath?.pathText === row.pathText;
              return (
                <RowItem
                  key={row.id}
                  row={row}
                  searchMatch={searchMatch}
                  isActiveMatch={isActive}
                  isSelected={isSelected}
                  onTogglePath={(path) => {
                    if (record.deferred) {
                      onHydrateRecord(record);
                    }
                    onTogglePath(path);
                  }}
                  onCopyPath={onCopyPath}
                  onCopyNode={onCopyNode}
                  onSelectNode={onSelectNode}
                  onHoverPath={onHoverPath}
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
          isActive
            ? "rounded bg-accent/45 font-medium ring-1 ring-accent/70"
            : "rounded bg-accent/25 font-medium"
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

interface RowItemProps {
  row: TreeRow;
  searchMatch?: SearchMatch | undefined;
  isActiveMatch: boolean;
  isSelected: boolean;
  onTogglePath: (path: string) => void;
  onCopyPath: (path: string) => void;
  onCopyNode: (row: TreeRow) => void;
  onSelectNode: (row: TreeRow) => void;
  onHoverPath: (path: string | null) => void;
  virtualized?: boolean;
  style?: CSSProperties;
  measureRef?: (node: HTMLDivElement | null) => void;
}

const RowItem = ({
  row,
  searchMatch,
  isActiveMatch,
  isSelected,
  onTogglePath,
  onCopyPath,
  onCopyNode,
  onSelectNode,
  onHoverPath,
  virtualized = false,
  style,
  measureRef,
}: RowItemProps) => {
  const { t } = useTranslation();
  const valueRanges = searchMatch?.valueRanges.length
    ? clampRanges(searchMatch.valueRanges, row.valueLabel.length)
    : [];
  return (
    <div
      ref={measureRef}
      id={row.id}
      className={`group ${virtualized ? "absolute left-0 top-0" : ""} flex w-full cursor-pointer items-center border-b border-border px-3 ${
        isSelected ? "bg-accent/10" : "hover:bg-surface-200/50"
      }`}
      style={style}
      onClick={() => onSelectNode(row)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelectNode(row);
        }
      }}
      onMouseEnter={() => onHoverPath(row.pathText)}
      onMouseLeave={() => onHoverPath(null)}
      role="button"
      tabIndex={0}
    >
      <div
        className="flex min-w-0 shrink-0 items-center gap-1.5 py-2"
        style={{ paddingLeft: `${row.depth * 14}px` }}
      >
        {row.wasStringified ? (
          <button
            type="button"
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-warning/40 bg-warning/10 text-warning"
            onClick={(event) => {
              event.stopPropagation();
              onTogglePath(row.pathText);
            }}
            aria-label={t("tree.toggle", { key: row.keyLabel })}
          >
            <ChevronRight
              className={`size-3 transition-transform ${row.expanded ? "rotate-90" : ""}`}
            />
          </button>
        ) : (
          <span className="h-5 w-5 shrink-0" />
        )}
        <span className="min-w-0 break-all font-mono text-[11px] leading-5 text-code-key">
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
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 overflow-hidden py-2 pl-2">
        {row.wasStringified ? (
          <Badge variant="warning" className="shrink-0 text-[10px]">
            <Sparkles className="mr-0.5 size-2.5" />
            nested json
          </Badge>
        ) : null}
        <span
          className={`min-w-0 break-all font-mono text-[11px] leading-5 ${getValueClassName(row)}`}
        >
          {valueRanges.length ? (
            <HighlightText text={row.valueLabel} ranges={valueRanges} isActive={isActiveMatch} />
          ) : (
            row.valueLabel
          )}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 py-2 pl-2 opacity-0 transition-opacity group-hover:opacity-100">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-[11px] text-text-muted"
          onClick={(event) => {
            event.stopPropagation();
            onCopyPath(row.jsonPath);
          }}
        >
          path
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-[11px] text-text-muted"
          onClick={(event) => {
            event.stopPropagation();
            onCopyPath(row.jqPath);
          }}
        >
          jq
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-[11px] text-text-muted"
          onClick={(event) => {
            event.stopPropagation();
            onCopyNode(row);
          }}
        >
          copy
        </Button>
      </div>
    </div>
  );
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
