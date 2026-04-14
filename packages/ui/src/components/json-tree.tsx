import type { JsonlRecord } from "@unquote/core";
import { ChevronRight, Copy, RotateCcw, Sparkles } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildRecordRows, type TreeRow } from "../lib/tree";
import { Badge } from "./badge";
import { Button } from "./button";
import { Card, CardContent } from "./card";

interface JsonTreeProps {
  record: JsonlRecord;
  expandedStringifiedPaths: Set<string>;
  restoredRecordIds: Set<string>;
  eager?: boolean;
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
  onTogglePath,
  onCopyRecord,
  onCopyPath,
  onCopyNode,
  onRestoreRecord,
  onHoverPath,
}: JsonTreeProps) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const [hydrated, setHydrated] = useState(eager);
  const rows = useMemo(
    () => (hydrated ? buildRecordRows(record, expandedStringifiedPaths, restoredRecordIds) : []),
    [expandedStringifiedPaths, hydrated, record, restoredRecordIds],
  );
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
          <span className="min-w-0 truncate text-[12px] text-text-secondary">
            {record.summary}
          </span>
          <span className="shrink-0 font-mono text-[11px] text-text-muted">
            {rows.length} nodes
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
            滚动到这里时加载节点
          </div>
        ) : null}
        {hydrated && shouldVirtualize ? (
          <div
            className="relative w-full"
            style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];
              if (!row) {
                return null;
              }

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
            {rows.map((row) => (
              <RowItem
                key={row.id}
                row={row}
                onTogglePath={onTogglePath}
                onCopyPath={onCopyPath}
                onCopyNode={onCopyNode}
                onHoverPath={onHoverPath}
              />
            ))}
          </div>
        ) : null}
      </div>
    </Card>
  );
};

interface RowItemProps {
  row: TreeRow;
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
  onTogglePath,
  onCopyPath,
  onCopyNode,
  onHoverPath,
  virtualized = false,
  style,
  measureRef,
}: RowItemProps) => (
  <div
    ref={measureRef}
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
          aria-label={`切换 ${row.keyLabel}`}
        >
          <ChevronRight
            className={`size-3 transition-transform ${row.expanded ? "rotate-90" : ""}`}
          />
        </button>
      ) : (
        <span className="h-5 w-5 shrink-0" />
      )}
      <span className="min-w-0 break-all font-mono text-[12px] leading-5 text-code-key">
        {row.keyLabel}
      </span>
    </div>
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 overflow-hidden py-2 pl-2">
      {row.wasStringified ? (
        <Badge variant="warning" className="shrink-0 text-[10px]">
          <Sparkles className="mr-0.5 size-2.5" />
          nested json
        </Badge>
      ) : null}
      <span className={`min-w-0 break-all font-mono text-[12px] leading-5 ${getValueClassName(row)}`}>
        {row.valueLabel}
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
