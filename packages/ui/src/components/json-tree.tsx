import type { JsonlRecord } from "@unquote/core";
import { ChevronRight, Copy, RotateCcw, Sparkles } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "../i18n/context";
import { buildRecordRows } from "../lib/tree";
import type { SearchMatch, TextRange, TreeRow } from "../lib/tree";
import { Badge } from "./badge";
import { Button } from "./button";
import { Card, CardContent } from "./card";

interface JsonTreeProps {
  record: JsonlRecord;
  expandedStringifiedPaths: Set<string>;
  restoredRecordIds: Set<string>;
  eager?: boolean;
  searchMatches: SearchMatch[];
  activeMatch: { recordId: string; pathText: string } | null;
  onTogglePath: (path: string) => void;
  onCopyRecord: () => void;
  onCopyPath: (path: string) => void;
  onCopyNode: (row: TreeRow) => void;
  onRestoreRecord: () => void;
  onHoverPath: (path: string | null) => void;
}

export const JsonTree = ({
  record,
  expandedStringifiedPaths,
  restoredRecordIds,
  eager = false,
  searchMatches,
  activeMatch,
  onTogglePath,
  onCopyRecord,
  onCopyPath,
  onCopyNode,
  onRestoreRecord,
  onHoverPath,
}: JsonTreeProps) => {
  const { t } = useTranslation();
  const cardRef = useRef<HTMLDivElement>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const [hydrated, setHydrated] = useState(eager);
  const rows = useMemo(
    () => (hydrated ? buildRecordRows(record, expandedStringifiedPaths, restoredRecordIds) : []),
    [expandedStringifiedPaths, hydrated, record, restoredRecordIds],
  );
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
    if (!activeMatch || activeMatch.recordId !== record.id) {
      return;
    }
    if (!hydrated) {
      setHydrated(true);
      return;
    }

    const index = rows.findIndex((row) => row.pathText === activeMatch.pathText);
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
  }, [activeMatch, record.id, hydrated, rows, shouldVirtualize, rowVirtualizer]);

  if (!record.node) {
    return (
      <Card id={record.id} className="min-h-[120px] overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[12px] text-text-secondary">#{record.lineNumber}</span>
            <span className="text-[12px] text-text-secondary">{record.summary}</span>
          </div>
        </div>
        <CardContent className="py-3">
          <Badge variant="danger">{record.error ?? "Parse error"}</Badge>
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
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 font-mono text-[12px] text-text-secondary">
            #{record.lineNumber}
          </span>
          <span className="min-w-0 truncate text-[12px] text-text-secondary">{record.summary}</span>
          <span className="shrink-0 font-mono text-[11px] text-text-muted">
            {t("tree.nodes", { count: rows.length })}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 w-7 px-0" onClick={onCopyRecord}>
            <Copy className="size-3.5" />
          </Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 px-0" onClick={onRestoreRecord}>
            <RotateCcw className="size-3.5" />
          </Button>
        </div>
      </div>
      <div ref={parentRef} className="max-h-[560px] overflow-auto bg-surface-50">
        {!hydrated ? (
          <div className="flex h-[200px] items-center justify-center px-6 text-[12px] text-text-muted">
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
                  onTogglePath={onTogglePath}
                  onCopyPath={onCopyPath}
                  onCopyNode={onCopyNode}
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
              return (
                <RowItem
                  key={row.id}
                  row={row}
                  searchMatch={searchMatch}
                  isActiveMatch={isActive}
                  onTogglePath={onTogglePath}
                  onCopyPath={onCopyPath}
                  onCopyNode={onCopyNode}
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
        className={isActive ? "rounded bg-accent/45 font-medium ring-1 ring-accent/70" : "rounded bg-accent/25 font-medium"}
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

interface RowItemProps {
  row: TreeRow;
  searchMatch?: SearchMatch | undefined;
  isActiveMatch: boolean;
  onTogglePath: (path: string) => void;
  onCopyPath: (path: string) => void;
  onCopyNode: (row: TreeRow) => void;
  onHoverPath: (path: string | null) => void;
  virtualized?: boolean;
  style?: CSSProperties;
  measureRef?: (node: HTMLDivElement | null) => void;
}

const RowItem = ({
  row,
  searchMatch,
  isActiveMatch,
  onTogglePath,
  onCopyPath,
  onCopyNode,
  onHoverPath,
  virtualized = false,
  style,
  measureRef,
}: RowItemProps) => {
  const { t } = useTranslation();
  return (
    <div
      ref={measureRef}
      id={row.id}
      className={`group ${virtualized ? "absolute left-0 top-0" : ""} flex w-full items-center border-b border-border px-3 hover:bg-surface-200/50`}
      style={style}
      onMouseEnter={() => onHoverPath(row.pathText)}
      onMouseLeave={() => onHoverPath(null)}
    >
      <div
        className="flex min-w-0 shrink-0 items-center gap-1.5 py-2"
        style={{ paddingLeft: `${row.depth * 14}px` }}
      >
        {row.wasStringified ? (
          <button
            type="button"
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-warning/40 bg-warning/10 text-warning"
            onClick={() => onTogglePath(row.pathText)}
            aria-label={t("tree.toggle", { key: row.keyLabel })}
          >
            <ChevronRight
              className={`size-3 transition-transform ${row.expanded ? "rotate-90" : ""}`}
            />
          </button>
        ) : (
          <span className="h-5 w-5 shrink-0" />
        )}
        <span className="min-w-0 break-all font-mono text-[12px] leading-5 text-code-key">
          {searchMatch?.keyRanges.length ? (
            <HighlightText text={row.keyLabel} ranges={searchMatch.keyRanges} isActive={isActiveMatch} />
          ) : searchMatch?.pathRanges.length ? (
            <HighlightText text={row.keyLabel} ranges={[{ start: 0, end: row.keyLabel.length }]} isActive={isActiveMatch} />
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
          className={`min-w-0 break-all font-mono text-[12px] leading-5 ${getValueClassName(row)}`}
        >
          {searchMatch?.valueRanges.length ? (
            <HighlightText text={row.valueLabel} ranges={searchMatch.valueRanges} isActive={isActiveMatch} />
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
          onClick={() => onCopyPath(row.pathText)}
        >
          path
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-[11px] text-text-muted"
          onClick={() => onCopyNode(row)}
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
