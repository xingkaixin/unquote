import type { JsonlRecord } from "@unquote/core";
import { ChevronRight, Copy, RotateCcw, Sparkles } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildRecordRows, type TreeRow } from "../lib/tree";
import { Badge } from "./badge";
import { Button } from "./button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./card";
import { Separator } from "./separator";

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
    estimateSize: () => 52,
    overscan: 12,
    measureElement: (element) => element?.getBoundingClientRect().height ?? 52,
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
      <Card className="min-h-[260px] overflow-hidden border-zinc-900/10 bg-white shadow-[0_24px_64px_rgba(15,23,42,0.06)]">
        <CardHeader>
          <CardTitle>Record #{record.lineNumber}</CardTitle>
          <CardDescription>{record.summary}</CardDescription>
        </CardHeader>
        <CardContent>
          <Badge variant="danger">{record.error ?? "Parse error"}</Badge>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      ref={cardRef}
      id={record.id}
      className="min-h-[420px] scroll-mt-6 overflow-hidden border-zinc-900/10 bg-white shadow-[0_24px_64px_rgba(15,23,42,0.06)] [contain-intrinsic-size:680px] [content-visibility:auto]"
    >
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle>Record #{record.lineNumber}</CardTitle>
            <CardDescription>{record.summary}</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={onCopyRecord}>
              <Copy className="size-4" />
              复制记录
            </Button>
            <Button variant="outline" size="sm" onClick={onRestoreRecord}>
              <RotateCcw className="size-4" />
              还原记录
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="bg-[linear-gradient(180deg,rgba(248,250,252,0.72),rgba(255,255,255,1))]">
        <div
          ref={parentRef}
          className="h-[520px] overflow-auto rounded-[24px] border border-zinc-200 bg-[#fffdfa]"
        >
          {!hydrated ? (
            <div className="flex h-full items-center justify-center px-6 text-sm text-zinc-400">
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
        <Separator className="my-3" />
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>nodes {rows.length}</span>
          <span>字符串中的嵌套 JSON 可以展开和收起</span>
        </div>
      </CardContent>
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
    className={`${virtualized ? "absolute left-0 top-0" : ""} w-full border-b border-zinc-100 px-4 py-1 hover:bg-zinc-50`}
    style={style}
    onMouseEnter={() => onHoverPath(row.pathText)}
    onMouseLeave={() => onHoverPath(null)}
  >
    <div className="grid min-h-[46px] grid-cols-[minmax(148px,220px)_minmax(0,1fr)_auto] items-start gap-3">
      <div
        className="flex min-w-0 items-start gap-2 py-2"
        style={{ paddingLeft: `${row.depth * 14}px` }}
      >
        {row.wasStringified ? (
          <button
            type="button"
            className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-amber-200 bg-amber-50 text-amber-700"
            onClick={() => onTogglePath(row.pathText)}
            aria-label={`切换 ${row.keyLabel}`}
          >
            <ChevronRight
              className={`size-3 transition-transform ${row.expanded ? "rotate-90" : ""}`}
            />
          </button>
        ) : (
          <span className="mt-0.5 h-5 w-5 shrink-0" />
        )}
        <span className="min-w-0 break-all font-mono text-[13px] leading-6 text-zinc-500">
          {row.keyLabel}
        </span>
      </div>
      <div className="flex min-w-0 flex-wrap items-start gap-2 py-2">
        {row.wasStringified ? (
          <Badge variant="warning" className="mt-0.5 normal-case tracking-[0.08em]">
            <Sparkles className="mr-1 size-3" />
            nested json
          </Badge>
        ) : null}
        <span className={getValueClassName(row)}>{row.valueLabel}</span>
      </div>
      <div className="flex items-center gap-1 py-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-zinc-500"
          onClick={() => onCopyPath(row.pathText)}
        >
          path
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-zinc-500"
          onClick={() => onCopyNode(row)}
        >
          copy
        </Button>
      </div>
    </div>
  </div>
);

const getValueClassName = (row: TreeRow) => {
  const base = "min-w-0 whitespace-pre-wrap break-all font-mono text-[13px] leading-6";

  switch (row.kind) {
    case "string":
      return `${base} text-emerald-800`;
    case "number":
      return `${base} text-amber-700`;
    case "boolean":
      return `${base} text-sky-700`;
    case "null":
      return `${base} text-zinc-400`;
    case "object":
    case "array":
      return `${base} text-zinc-600`;
    default:
      return `${base} text-zinc-700`;
  }
};
