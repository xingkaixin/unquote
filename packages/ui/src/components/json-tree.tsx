import type { JsonlRecord } from "@unquote/core";
import { ChevronRight, Copy, FileWarning } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { CSSProperties, KeyboardEvent } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "../i18n/context";
import { preferredScrollBehavior } from "../lib/motion-preference";
import { isPathWithin } from "../lib/path-codec";
import { measurePerfFn } from "../lib/perf";
import type { SearchMatch, TextRange } from "../lib/record-search";
import type { RecordViewActions } from "../lib/record-view";
import {
  resolvePathScrollIndex,
  targetsPathInRecord,
  type ScrollIntent,
} from "../lib/scroll-intent";
import { buildDisplayRows, getDisplayValueClassName } from "../lib/tree-display";
import type { DisplayTreeRow } from "../lib/tree-display";
import { buildRecordRows } from "../lib/tree";
import type { TreeRow } from "../lib/tree";
import { Button } from "./button";

// A record only virtualizes past a row count and when every row is short and
// single-line: tall (long or multiline) values break the virtualizer's
// fixed-size row estimate.
const virtualizationRowThreshold = 180;
const inlineValueLengthLimit = 160;
const rowEstimateSize = 24;

interface JsonTreeProps {
  record: JsonlRecord;
  expandedStringifiedPaths: ReadonlySet<string>;
  searchMatches: SearchMatch[];
  activeMatchPath: string | null;
  scrollIntent: ScrollIntent | null;
  selectedPath: string | null;
  actions: RecordViewActions;
}

export const JsonTree = memo(function JsonTree({
  record,
  expandedStringifiedPaths,
  searchMatches,
  activeMatchPath,
  scrollIntent,
  selectedPath,
  actions,
}: JsonTreeProps) {
  const { t } = useTranslation();
  const parentRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(
    () =>
      measurePerfFn("recordRows:build", () => buildRecordRows(record, expandedStringifiedPaths)),
    [expandedStringifiedPaths, record],
  );
  const displayRows = useMemo(() => buildDisplayRows(rows), [rows]);
  const interactiveRows = useMemo(
    () => displayRows.filter((row) => row.kind !== "close"),
    [displayRows],
  );
  const [activeRowId, setActiveRowId] = useState<string | undefined>();
  // Keyboard navigation resolves a row id to its position on every keypress.
  // Building the lookups once per row-set change keeps that O(1): the row set
  // only changes on expand/collapse or a new search, far less often than keys.
  const interactiveIndexById = useMemo(() => {
    const indexById = new Map<string, number>();
    interactiveRows.forEach((row, index) => indexById.set(row.id, index));
    return indexById;
  }, [interactiveRows]);
  const displayIndexById = useMemo(() => {
    const indexById = new Map<string, number>();
    displayRows.forEach((row, index) => indexById.set(row.id, index));
    return indexById;
  }, [displayRows]);

  useEffect(() => {
    if (activeRowId !== undefined && interactiveIndexById.has(activeRowId)) {
      return;
    }

    setActiveRowId(interactiveRows[0]?.id);
  }, [activeRowId, interactiveIndexById, interactiveRows]);

  const searchMatchMap = useMemo(() => {
    const map = new Map<string, SearchMatch>();
    for (const match of searchMatches) {
      map.set(match.pathText, match);
    }
    return map;
  }, [searchMatches]);

  const shouldVirtualize = useMemo(
    () =>
      displayRows.length > virtualizationRowThreshold &&
      displayRows.every(
        (row) => row.valueText.length < inlineValueLengthLimit && !row.valueText.includes("\\n"),
      ),
    [displayRows],
  );
  const rowVirtualizer = useVirtualizer({
    count: displayRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowEstimateSize,
    overscan: 12,
    measureElement: (element) => element?.getBoundingClientRect().height ?? rowEstimateSize,
    enabled: shouldVirtualize,
  });

  const toggleRow = useCallback(
    (row: DisplayTreeRow) => {
      if (record.status === "preview") {
        actions.requestFullRecord(record);
      }
      actions.togglePath(record.id, row.source.pathText);
    },
    [actions, record],
  );
  const selectNode = useCallback(
    (row: TreeRow) => actions.selectNode(record, row),
    [actions, record],
  );

  const handleTreeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const currentIndex =
      activeRowId === undefined ? 0 : (interactiveIndexById.get(activeRowId) ?? 0);
    const activeRow = interactiveRows[currentIndex];
    if (!activeRow) {
      return;
    }

    let nextIndex: number | undefined;
    switch (event.key) {
      case "ArrowDown":
        nextIndex = Math.min(currentIndex + 1, interactiveRows.length - 1);
        break;
      case "ArrowUp":
        nextIndex = Math.max(currentIndex - 1, 0);
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = interactiveRows.length - 1;
        break;
      case "ArrowRight":
        if (activeRow.showToggle && !activeRow.source.expanded) {
          toggleRow(activeRow);
        }
        break;
      case "ArrowLeft":
        if (activeRow.showToggle && activeRow.source.expanded) {
          toggleRow(activeRow);
        } else {
          for (let index = currentIndex - 1; index >= 0; index--) {
            if (interactiveRows[index]!.depth < activeRow.depth) {
              nextIndex = index;
              break;
            }
          }
        }
        break;
      case "Enter":
      case " ":
        selectNode(activeRow.source);
        break;
      default:
        return;
    }

    event.preventDefault();
    if (nextIndex !== undefined && nextIndex >= 0) {
      const nextRowId = interactiveRows[nextIndex]!.id;
      setActiveRowId(nextRowId);
      if (shouldVirtualize) {
        rowVirtualizer.scrollToIndex(displayIndexById.get(nextRowId) ?? -1, { align: "auto" });
      } else {
        document.getElementById(nextRowId)?.scrollIntoView({ block: "nearest" });
      }
    }
  };

  useEffect(() => {
    if (!targetsPathInRecord(scrollIntent, record.id)) {
      return;
    }

    const index = resolvePathScrollIndex(displayRows, record.id, scrollIntent);
    if (index === -1) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      if (shouldVirtualize) {
        rowVirtualizer.scrollToIndex(index, { align: "center" });
      } else {
        const element = document.getElementById(displayRows[index]!.id);
        element?.scrollIntoView({ block: "center", behavior: preferredScrollBehavior() });
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [scrollIntent, record.id, displayRows, shouldVirtualize, rowVirtualizer]);

  if (record.status === "failed") {
    const errorMeta = record.errorMeta;
    const rawLine = record.rawLine;
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex flex-col gap-2 border-b border-border bg-surface-100 px-4 py-[11px] sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <span className="font-mono text-[11px] text-text-secondary">#{record.lineNumber}</span>
            <span
              className="size-[7px] shrink-0 rounded-full"
              style={{ background: "var(--dot-error)" }}
            />
            <span className="font-mono text-[10.5px] uppercase tracking-[var(--tracking-tag)] text-error">
              {t("error.parseFailed")}
            </span>
            <span className="min-w-0 truncate text-[11px] text-text-secondary">
              {record.summary}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => actions.copyRawLine(record)}
            >
              <Copy className="size-3" />
              {t("error.copyRawLine")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => actions.copyError(record)}
            >
              <Copy className="size-3" />
              {t("error.copyDetails")}
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-2 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
            <span className="inline-flex items-center gap-1 text-error">
              <FileWarning className="size-3" />
              {t("error.parseFailed")}
            </span>
            {errorMeta ? (
              <span className="rounded-sm border border-border px-1.5 py-0.5 text-text-secondary">
                {t("error.location", { line: errorMeta.line, column: errorMeta.column })}
              </span>
            ) : null}
          </div>
          <div className="min-w-0 break-words font-mono text-[11px] leading-5 text-text-secondary">
            {record.error ?? t("error.parseFailed")}
          </div>
          {errorMeta ? (
            <div className="flex flex-col gap-1.5">
              <div className="text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
                {t("error.rawLine")}
              </div>
              <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all border border-border bg-surface-100 px-2 py-1.5 font-mono text-[10px] leading-5 text-text-secondary">
                {rawLine}
              </pre>
              <div className="text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
                {t("error.context")}
              </div>
              <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-all border border-border bg-surface-100 px-2 py-1.5 font-mono text-[10px] leading-5 text-text-secondary">
                {errorMeta.context}
              </pre>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      data-tree-scroller
      className="group/tree min-h-0 flex-1 overflow-auto py-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
      role="tree"
      aria-label={record.summary}
      aria-activedescendant={activeRowId}
      tabIndex={0}
      onKeyDown={handleTreeKeyDown}
    >
      {shouldVirtualize ? (
        <div className="relative w-full" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const row = displayRows[virtualRow.index];
            if (!row) {
              return null;
            }

            const searchMatch =
              row.kind === "close" ? undefined : searchMatchMap.get(row.source.pathText);
            const isActive = row.kind !== "close" && activeMatchPath === row.source.pathText;
            const isSelected = selectedPath
              ? isPathWithin(row.source.pathText, selectedPath)
              : false;
            const isSelectedAnchor = selectedPath === row.source.pathText;

            return (
              <RowItem
                key={row.id}
                row={row}
                virtualized
                virtualIndex={virtualRow.index}
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
                isActiveDescendant={row.id === activeRowId}
                onSelectNode={selectNode}
                onActivate={setActiveRowId}
                onTogglePath={toggleRow}
              />
            );
          })}
        </div>
      ) : (
        <div>
          {displayRows.map((row) => {
            const searchMatch =
              row.kind === "close" ? undefined : searchMatchMap.get(row.source.pathText);
            const isActive = row.kind !== "close" && activeMatchPath === row.source.pathText;
            const isSelected = selectedPath
              ? isPathWithin(row.source.pathText, selectedPath)
              : false;
            const isSelectedAnchor = selectedPath === row.source.pathText;
            return (
              <RowItem
                key={row.id}
                row={row}
                searchMatch={searchMatch}
                isActiveMatch={isActive}
                isSelected={isSelected}
                isSelectedAnchor={isSelectedAnchor}
                isActiveDescendant={row.id === activeRowId}
                onSelectNode={selectNode}
                onActivate={setActiveRowId}
                onTogglePath={toggleRow}
              />
            );
          })}
        </div>
      )}
    </div>
  );
});

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

interface RowItemProps {
  row: DisplayTreeRow;
  searchMatch?: SearchMatch | undefined;
  isActiveMatch: boolean;
  isSelected: boolean;
  isSelectedAnchor: boolean;
  isActiveDescendant: boolean;
  onSelectNode: (row: TreeRow) => void;
  onActivate: (rowId: string) => void;
  onTogglePath: (row: DisplayTreeRow) => void;
  virtualized?: boolean;
  virtualIndex?: number;
  style?: CSSProperties;
  measureRef?: (node: HTMLDivElement | null) => void;
}

const RowItem = memo(function RowItem({
  row,
  searchMatch,
  isActiveMatch,
  isSelected,
  isSelectedAnchor,
  isActiveDescendant,
  onSelectNode,
  onActivate,
  onTogglePath,
  virtualized = false,
  virtualIndex,
  style,
  measureRef,
}: RowItemProps) {
  const source = row.source;
  const valueRanges =
    row.kind === "value" && searchMatch?.valueRanges.length
      ? clampRanges(searchMatch.valueRanges, row.valueText.length)
      : [];
  const rowTone = isActiveMatch
    ? "bg-accent-soft"
    : searchMatch
      ? "bg-[color-mix(in_srgb,var(--color-accent)_6%,transparent)]"
      : isSelected
        ? "bg-surface-50"
        : "hover:bg-surface-50";
  // The accent bar marks the active match; a stringified boundary keeps a muted
  // bar so an expanded escaped payload stays visually attached to its source.
  const railTone =
    isActiveMatch || isSelectedAnchor
      ? "shadow-[inset_3px_0_0_var(--color-accent)]"
      : source.wasStringified
        ? "shadow-[inset_3px_0_0_var(--color-border-medium)]"
        : "";
  const activeDescendantTone = isActiveDescendant
    ? "group-focus-visible/tree:outline group-focus-visible/tree:outline-1 group-focus-visible/tree:-outline-offset-1 group-focus-visible/tree:outline-accent"
    : "";

  // `uq-row-in` stays off the virtualized branch: windowed rows remount on every
  // scroll step, which would replay the entrance animation continuously.
  return (
    <div
      ref={measureRef}
      id={row.id}
      data-index={virtualIndex}
      className={`group ${virtualized ? "absolute left-0 top-0" : "uq-row-in"} flex min-h-[24px] w-full ${row.kind === "close" ? "cursor-default" : "cursor-pointer"} items-start px-4 ${rowTone} ${railTone} ${activeDescendantTone}`}
      style={style}
      onClick={(event) => {
        if (row.kind === "close") {
          return;
        }

        onActivate(row.id);
        if ((event.target as Element).closest("[data-tree-toggle]")) {
          onTogglePath(row);
          return;
        }
        onSelectNode(source);
      }}
      role={row.kind === "close" ? "presentation" : "treeitem"}
      aria-level={row.kind === "close" ? undefined : row.depth + 1}
      aria-selected={row.kind === "close" ? undefined : isSelectedAnchor}
      aria-expanded={row.showToggle ? source.expanded : undefined}
      tabIndex={row.kind === "close" ? undefined : -1}
    >
      <span style={{ width: `${row.depth * 16}px` }} className="shrink-0" />
      <div className="flex min-w-0 flex-1 items-start py-0.5">
        {row.showToggle ? (
          <span
            data-tree-toggle
            aria-hidden="true"
            className="relative mr-1.5 mt-[3px] inline-flex size-[15px] shrink-0 items-center justify-center border border-accent bg-accent/10 text-accent before:absolute before:-inset-[5px] before:content-['']"
          >
            <ChevronRight
              className={`uq-motion-transform size-2.5 transition-transform ${source.expanded ? "rotate-90" : ""}`}
            />
          </span>
        ) : (
          <span className="w-[21px] shrink-0" />
        )}
        {row.keyLabel ? (
          <>
            <span className="font-mono text-[11.5px] leading-[1.85] text-code-key">"</span>
            <span className="font-mono text-[11.5px] leading-[1.85] text-code-key">
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
});
