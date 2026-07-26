import type { JsonlRecord } from "@unquote/core";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { preferredScrollBehavior } from "../lib/motion-preference";
import { getExpandedStringifiedPaths } from "../lib/record-expansion";
import type { RecordViewModel } from "../lib/record-view";
import { resolveRecordScrollIndex, type ScrollIntent } from "../lib/scroll-intent";
import type { SearchMatch } from "../lib/tree";
import { JsonTree } from "./json-tree";

export const recordVirtualizationThreshold = 160;
const recordEstimateSize = 260;
const recordGap = 12;
const noSearchMatches: SearchMatch[] = [];

interface RecordListProps {
  records: JsonlRecord[];
  recordView: RecordViewModel;
  searchMatches: SearchMatch[];
  activeMatch: { recordId: string; pathText: string } | null;
  scrollIntent: ScrollIntent | null;
  onActiveRecordChange: (recordId: string) => void;
}

export const RecordList = memo(function RecordList({
  records,
  recordView,
  searchMatches,
  activeMatch,
  scrollIntent,
  onActiveRecordChange,
}: RecordListProps) {
  const {
    state: {
      recordInsights,
      resolveRecord,
      expandedStringifiedPathsByRecord,
      selectedPath,
      focusedPath,
    },
    actions,
  } = recordView;
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
    (index: number) => {
      if (shouldVirtualize) {
        recordVirtualizer.scrollToIndex(index, { align: "start" });
        return;
      }

      const record = records[index];
      if (!record) {
        return;
      }
      const frame = requestAnimationFrame(() => {
        listRef.current
          ?.querySelector<HTMLElement>(`[id="${record.id}"]`)
          ?.scrollIntoView({ block: "start", behavior: preferredScrollBehavior() });
      });

      return () => cancelAnimationFrame(frame);
    },
    [recordVirtualizer, records, shouldVirtualize],
  );

  useLayoutEffect(() => {
    const index = resolveRecordScrollIndex(records, scrollIntent);
    if (index === -1) {
      return;
    }

    return scrollToRecord(index);
  }, [records, scrollIntent, scrollToRecord]);

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
      const element = listRef.current?.querySelector<HTMLElement>(`[id="${record.id}"]`);
      if (element) {
        observer.observe(element);
      }
    }

    return () => observer.disconnect();
  }, [onActiveRecordChange, records, shouldVirtualize]);

  const renderRecord = (record: JsonlRecord, index: number) => {
    const renderedRecord = resolveRecord(record);

    return (
      <JsonTree
        key={renderedRecord.id}
        record={renderedRecord}
        insight={recordInsights.get(record.id)}
        expandedStringifiedPaths={getExpandedStringifiedPaths(
          expandedStringifiedPathsByRecord,
          renderedRecord.id,
        )}
        eager={index < 6}
        searchMatches={searchMatchesByRecord.get(record.id) ?? noSearchMatches}
        activeMatch={activeMatch?.recordId === record.id ? activeMatch : null}
        scrollIntent={scrollIntent}
        selectedPath={selectedPath?.recordId === record.id ? selectedPath : null}
        focusedPath={focusedPath?.recordId === record.id ? focusedPath : null}
        actions={actions}
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
});
