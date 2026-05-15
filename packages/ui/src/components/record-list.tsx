import type { JsonlRecord } from "@unquote/core";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { SearchMatch } from "../lib/tree";
import { JsonTree } from "./json-tree";

const recordVirtualizationThreshold = 160;
const recordEstimateSize = 260;
const recordGap = 12;

interface RecordListProps {
  records: JsonlRecord[];
  expandedStringifiedPaths: Set<string>;
  restoredRecordIds: Set<string>;
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
  onCopyPath: (path: string) => void;
  onCopyNode: (recordId: string, row: import("../lib/tree").TreeRow) => void;
  onSelectNode: (record: JsonlRecord, row: import("../lib/tree").TreeRow) => void;
  onRestoreRecord: (recordId: string) => void;
  onClearFocus: () => void;
  onHoverPath: (path: string | null) => void;
  onActiveRecordChange: (recordId: string) => void;
}

export const RecordList = ({
  records,
  expandedStringifiedPaths,
  restoredRecordIds,
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
  onCopyPath,
  onCopyNode,
  onSelectNode,
  onRestoreRecord,
  onClearFocus,
  onHoverPath,
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

  const renderRecord = (record: JsonlRecord, index: number) => (
    <JsonTree
      key={record.id}
      record={record}
      expandedStringifiedPaths={expandedStringifiedPaths}
      restoredRecordIds={restoredRecordIds}
      eager={index < 6}
      searchMatches={searchMatchesByRecord.get(record.id) ?? []}
      activeMatch={activeMatch?.recordId === record.id ? activeMatch : null}
      scrollTarget={scrollTarget?.recordId === record.id ? scrollTarget : null}
      selectedPath={selectedPath?.recordId === record.id ? selectedPath : null}
      focusedPath={focusedPath?.recordId === record.id ? focusedPath : null}
      onTogglePath={onTogglePath}
      onCopyRecord={() => onCopyRecord(record)}
      onCopyRawLine={() => onCopyRawLine(record)}
      onCopyError={() => onCopyError(record)}
      onCopyPath={onCopyPath}
      onCopyNode={(row) => onCopyNode(record.id, row)}
      onSelectNode={(row) => onSelectNode(record, row)}
      onRestoreRecord={() => onRestoreRecord(record.id)}
      onClearFocus={onClearFocus}
      onHoverPath={onHoverPath}
    />
  );

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
