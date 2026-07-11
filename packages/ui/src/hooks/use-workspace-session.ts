import type { JsonlRecord } from "@unquote/core";
import { useCallback, useRef, useState } from "react";
import type { AgentDetailSelection } from "../components/agent-session-view";
import { isPathWithin } from "../lib/path-codec";
import { markPerf, measurePerfFn } from "../lib/perf";
import {
  addExpandedStringifiedPaths,
  clearExpandedStringifiedPaths,
  getExpandedStringifiedPaths,
  groupExpandedStringifiedPaths,
  replaceExpandedStringifiedPaths,
  toggleExpandedStringifiedPath,
  type ExpandedStringifiedPathsByRecord,
} from "../lib/record-expansion";
import { collectStringifiedPaths } from "../lib/tree";
import type { SearchMatch, TreeRow } from "../lib/tree";

export interface PathScrollTarget {
  recordId: string;
  pathText: string;
  requestId: number;
}

export interface SelectedPath {
  recordId: string;
  pathText: string;
  rawKey: string;
}

interface RecordScrollTarget {
  recordId: string;
  requestId: number;
}

const createSelectionFromRow = (record: JsonlRecord, row: TreeRow): SelectedPath => ({
  recordId: record.id,
  pathText: row.pathText,
  rawKey: row.keyLabel,
});

export const useWorkspaceSession = () => {
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null);
  const [detailSelection, setDetailSelection] = useState<AgentDetailSelection | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<ExpandedStringifiedPathsByRecord>(new Map());
  const [searchExpandedPaths, setSearchExpandedPaths] = useState<ExpandedStringifiedPathsByRecord>(
    new Map(),
  );
  const [selectedPath, setSelectedPath] = useState<SelectedPath | null>(null);
  const [focusedPath, setFocusedPath] = useState<{
    recordId: string;
    pathText: string;
  } | null>(null);
  const [scrollTarget, setScrollTarget] = useState<PathScrollTarget | null>(null);
  const [recordScrollTarget, setRecordScrollTarget] = useState<RecordScrollTarget | null>(null);
  const scrollRequestIdRef = useRef(0);

  const nextRequestId = useCallback(() => {
    scrollRequestIdRef.current += 1;
    return scrollRequestIdRef.current;
  }, []);

  const scrollToPath = useCallback(
    (recordId: string, pathText: string) => {
      setFocusedPath((current) =>
        current && (current.recordId !== recordId || !isPathWithin(pathText, current.pathText))
          ? null
          : current,
      );
      setScrollTarget({ recordId, pathText, requestId: nextRequestId() });
    },
    [nextRequestId],
  );

  const selectPath = useCallback(
    (selection: SelectedPath, stringifiedPathChain: readonly string[] = []) => {
      setSelectedPath(selection);
      setActiveRecordId(selection.recordId);
      if (stringifiedPathChain.length > 0) {
        setExpandedPaths((current) =>
          addExpandedStringifiedPaths(current, selection.recordId, stringifiedPathChain),
        );
      }
      scrollToPath(selection.recordId, selection.pathText);
    },
    [scrollToPath],
  );

  const selectNode = useCallback(
    (record: JsonlRecord, row: TreeRow) => selectPath(createSelectionFromRow(record, row)),
    [selectPath],
  );

  const selectRecord = useCallback(
    (record: JsonlRecord) => {
      setActiveRecordId(record.id);
      setDetailSelection({ kind: "record", recordId: record.id });
      setFocusedPath((current) => (current?.recordId === record.id ? current : null));
      setRecordScrollTarget({ recordId: record.id, requestId: nextRequestId() });
    },
    [nextRequestId],
  );

  const selectAgentDetail = useCallback((selection: AgentDetailSelection) => {
    setActiveRecordId(selection.recordId);
    setDetailSelection(selection);
    setFocusedPath((current) => (current?.recordId === selection.recordId ? current : null));
  }, []);

  const reset = useCallback(() => {
    setExpandedPaths(new Map());
    setSearchExpandedPaths(new Map());
    setSelectedPath(null);
    setDetailSelection(null);
    setFocusedPath(null);
    setScrollTarget(null);
    setRecordScrollTarget(null);
  }, []);

  const reconcileVisibleRecords = useCallback((records: readonly JsonlRecord[]) => {
    const visibleRecordIds = new Set(records.map((record) => record.id));
    const firstRecordId = records[0]?.id ?? null;
    setActiveRecordId((current) =>
      current && visibleRecordIds.has(current) ? current : firstRecordId,
    );
    setSelectedPath((current) =>
      current && !visibleRecordIds.has(current.recordId) ? null : current,
    );
    setDetailSelection((current) =>
      current && !visibleRecordIds.has(current.recordId) ? null : current,
    );
    setFocusedPath((current) =>
      current && !visibleRecordIds.has(current.recordId) ? null : current,
    );
    setScrollTarget((current) =>
      current && !visibleRecordIds.has(current.recordId) ? null : current,
    );
    setRecordScrollTarget((current) =>
      current && !visibleRecordIds.has(current.recordId) ? null : current,
    );
  }, []);

  const synchronizeSearchExpansions = useCallback((matches: readonly SearchMatch[]) => {
    setSearchExpandedPaths(groupExpandedStringifiedPaths(matches));
  }, []);

  const setSampleExpansions = useCallback(
    (entries: readonly { recordId: string; paths: readonly string[] }[]) => {
      setExpandedPaths(new Map(entries.map(({ recordId, paths }) => [recordId, new Set(paths)])));
    },
    [],
  );

  const expandAll = useCallback(
    (records: readonly JsonlRecord[], displayedExpandedPaths: ExpandedStringifiedPathsByRecord) => {
      setExpandedPaths((current) =>
        measurePerfFn("expand:all:collect", () => {
          let next = current;
          for (const record of records) {
            const paths = collectStringifiedPaths(
              record,
              getExpandedStringifiedPaths(displayedExpandedPaths, record.id),
            );
            next = replaceExpandedStringifiedPaths(next, record.id, paths);
          }
          return next;
        }),
      );
      markPerf("expand:all:set-state");
    },
    [],
  );

  const collapseAll = useCallback((recordIds: readonly string[]) => {
    setExpandedPaths((current) => clearExpandedStringifiedPaths(current, recordIds));
    setSearchExpandedPaths((current) => clearExpandedStringifiedPaths(current, recordIds));
  }, []);

  const togglePath = useCallback((recordId: string, path: string) => {
    markPerf("expand:path");
    setExpandedPaths((current) => toggleExpandedStringifiedPath(current, recordId, path));
  }, []);

  const clearFocus = useCallback(() => setFocusedPath(null), []);
  const clearPathScroll = useCallback(() => setScrollTarget(null), []);
  const reportActiveRecord = useCallback((recordId: string) => {
    setActiveRecordId((current) => (current === recordId ? current : recordId));
  }, []);

  return {
    state: {
      activeRecordId,
      detailSelection,
      expandedPaths,
      searchExpandedPaths,
      selectedPath,
      focusedPath,
      scrollTarget,
      recordScrollTarget,
    },
    reset,
    selectPath,
    selectNode,
    selectRecord,
    selectAgentDetail,
    scrollToPath,
    reconcileVisibleRecords,
    synchronizeSearchExpansions,
    setSampleExpansions,
    expandAll,
    collapseAll,
    togglePath,
    clearFocus,
    clearPathScroll,
    reportActiveRecord,
  };
};
