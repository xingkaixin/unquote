import type { JsonlRecord } from "@unquote/core";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { resolveHydratedRecord } from "../lib/record-resolution";
import type { RecordInsight } from "../lib/record-insight";
import type { SearchMatch } from "../lib/tree";
import { JsonTree } from "./json-tree";

export const recordVirtualizationThreshold = 160;
const recordEstimateSize = 260;
const recordGap = 12;

interface RecordListProps {
  records: JsonlRecord[];
  recordInsights: ReadonlyMap<string, RecordInsight>;
  hydratedRecords: ReadonlyMap<number, JsonlRecord>;
  expandedStringifiedPaths: Set<string>;
  searchMatches: SearchMatch[];
  activeMatch: { recordId: string; pathText: string } | null;
  scrollTarget: { recordId: string; pathText: string; requestId: number } | null;
  recordScrollTarget: { recordId: string; requestId: number } | null;
  selectedPath: { recordId: string; pathText: string } | null;
  focusedPath: { recordId: string; pathText: string } | null;
  onTogglePath: (path: string) => void;
  onCopyRecord: (record: JsonlRecord) => void;
  onCopyRawLine: (record: JsonlRecord) => void;
  onCopyError: (record: JsonlRecord) => void;
  onSelectNode: (record: JsonlRecord, row: import("../lib/tree").TreeRow) => void;
  onHydrateRecord: (record: JsonlRecord) => void;
  onClearFocus: () => void;
  onActiveRecordChange: (recordId: string) => void;
}

export const RecordList = ({
  records,
  recordInsights,
  hydratedRecords,
  expandedStringifiedPaths,
  searchMatches,
  activeMatch,
  scrollTarget,
  recordScrollTarget,
  selectedPath,
  focusedPath,
  onTogglePath,
  onCopyRecord,
  onCopyRawLine,
  onCopyError,
  onSelectNode,
  onHydrateRecord,
  onClearFocus,
  onActiveRecordChange,
}: RecordListProps) => {
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const shouldVirtualize = records.length > recordVirtualizationThreshold;
  const searchMatchesByRecord = useMemo(() => {
    const map = new Map<string, SearchMatch[]>();
    for (const match of searchMatches) {
      const matches = map.get(match.recordId);
      if (matches) {
        matches.push(match);
      } else {
        map.set(match.recordId, [match]);
      }
    }
    return map;
  }, [searchMatches]);
  const recordVirtualizer = useWindowVirtualizer<HTMLDivElement>({
    count: records.length,
    estimateSize: () => recordEstimateSize,
    overscan: 4,
    gap: recordGap,
    getItemKey: (index) => records[index]?.id ?? index,
    scrollMargin,
    enabled: shouldVirtualize,
  });
  const virtualRecords = recordVirtualizer.getVirtualItems();

  useLayoutEffect(() => {
    if (!shouldVirtualize) {
      setScrollMargin(0);
      return;
    }

    const updateScrollMargin = () => {
      const element = listRef.current;
      setScrollMargin(element ? element.getBoundingClientRect().top + window.scrollY : 0);
    };

    updateScrollMargin();
    window.addEventListener("resize", updateScrollMargin);
    return () => window.removeEventListener("resize", updateScrollMargin);
  }, [records.length, shouldVirtualize]);

  const scrollToRecord = useCallback(
    (recordId: string) => {
      const index = records.findIndex((record) => record.id === recordId);
      if (index === -1) {
        return;
      }

      if (shouldVirtualize) {
        recordVirtualizer.scrollToIndex(index, { align: "start" });
        return;
      }

      const frame = requestAnimationFrame(() => {
        document.getElementById(recordId)?.scrollIntoView({ block: "start", behavior: "smooth" });
      });

      return () => cancelAnimationFrame(frame);
    },
    [recordVirtualizer, records, shouldVirtualize],
  );

  useLayoutEffect(() => {
    if (!recordScrollTarget) {
      return;
    }

    return scrollToRecord(recordScrollTarget.recordId);
  }, [recordScrollTarget, scrollToRecord]);

  useLayoutEffect(() => {
    const targetRecordId = scrollTarget?.recordId ?? activeMatch?.recordId;
    if (!targetRecordId) {
      return;
    }

    return scrollToRecord(targetRecordId);
  }, [activeMatch, scrollTarget, scrollToRecord]);

  useLayoutEffect(() => {
    if (!shouldVirtualize) {
      return;
    }

    const first = virtualRecords[0];
    const record = first ? records[first.index] : undefined;
    if (record) {
      onActiveRecordChange(record.id);
    }
  }, [onActiveRecordChange, records, shouldVirtualize, virtualRecords]);

  // Non-virtual path: derive the active record from the most-visible card.
  // Both branches of the active-record rule live here so the app no longer
  // maintains a parallel observer keyed on the virtualization threshold.
  useLayoutEffect(() => {
    if (shouldVirtualize || records.length === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];

        if (visible?.target.id) {
          onActiveRecordChange(visible.target.id);
        }
      },
      {
        root: null,
        threshold: [0.3, 0.6, 0.9],
      },
    );

    for (const record of records) {
      const element = document.getElementById(record.id);
      if (element) {
        observer.observe(element);
      }
    }

    return () => observer.disconnect();
  }, [onActiveRecordChange, records, shouldVirtualize]);

  const renderRecord = (record: JsonlRecord, index: number) => {
    const renderedRecord = resolveHydratedRecord(record, hydratedRecords);

    return (
      <JsonTree
        key={renderedRecord.id}
        record={renderedRecord}
        insight={recordInsights.get(record.id)}
        expandedStringifiedPaths={expandedStringifiedPaths}
        eager={index < 6}
        searchMatches={searchMatchesByRecord.get(record.id) ?? []}
        activeMatch={activeMatch?.recordId === record.id ? activeMatch : null}
        scrollTarget={scrollTarget?.recordId === record.id ? scrollTarget : null}
        selectedPath={selectedPath?.recordId === record.id ? selectedPath : null}
        focusedPath={focusedPath?.recordId === record.id ? focusedPath : null}
        onTogglePath={onTogglePath}
        onCopyRecord={() => onCopyRecord(renderedRecord)}
        onCopyRawLine={() => onCopyRawLine(renderedRecord)}
        onCopyError={() => onCopyError(renderedRecord)}
        onSelectNode={(row) => onSelectNode(renderedRecord, row)}
        onHydrateRecord={onHydrateRecord}
        onClearFocus={onClearFocus}
      />
    );
  };

  if (!shouldVirtualize) {
    return (
      <div ref={listRef} className="flex flex-col gap-3">
        {records.map((record, index) => renderRecord(record, index))}
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      className="relative w-full"
      style={{ height: `${recordVirtualizer.getTotalSize()}px` }}
    >
      {virtualRecords.map((virtualRecord) => {
        const record = records[virtualRecord.index];
        if (!record) {
          return null;
        }

        return (
          <div
            key={record.id}
            ref={(node) => {
              if (node) {
                recordVirtualizer.measureElement(node);
              }
            }}
            data-index={virtualRecord.index}
            className="absolute left-0 top-0 w-full"
            style={{
              transform: `translateY(${virtualRecord.start - scrollMargin}px)`,
            }}
          >
            {renderRecord(record, virtualRecord.index)}
          </div>
        );
      })}
    </div>
  );
};
