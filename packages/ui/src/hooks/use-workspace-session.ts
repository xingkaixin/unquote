import type { JsonlRecord } from "@unquote/core";
import { useCallback, useReducer, useRef, useState } from "react";
import { hasUnchangedArrayPrefix } from "../lib/partial-record-cache";
import { markPerf, measurePerfFn } from "../lib/perf";
import {
  addExpandedStringifiedPaths,
  clearExpandedStringifiedPaths,
  getExpandedStringifiedPaths,
  groupExpandedStringifiedPaths,
  replaceExpandedStringifiedPathsBatch,
  toggleExpandedStringifiedPath,
  type ExpandedStringifiedPathsByRecord,
} from "../lib/record-expansion";
import { collectStringifiedPaths } from "../lib/tree";
import type { SearchMatch, TreeRow } from "../lib/tree";
import {
  createInitialWorkspaceSelectionState,
  reduceWorkspaceSelection,
} from "../lib/workspace-selection";
import type { AgentDetailSelection, SelectedPath } from "../lib/workspace-selection";

export type { SelectedPath } from "../lib/workspace-selection";

const createSelectionFromRow = (record: JsonlRecord, row: TreeRow): SelectedPath => ({
  recordId: record.id,
  pathText: row.pathText,
  rawKey: row.keyLabel,
});

export const useWorkspaceSession = () => {
  const [selectionState, dispatchSelection] = useReducer(
    reduceWorkspaceSelection,
    undefined,
    createInitialWorkspaceSelectionState,
  );
  const [expandedPaths, setExpandedPaths] = useState<ExpandedStringifiedPathsByRecord>(new Map());
  const [searchExpandedPaths, setSearchExpandedPaths] = useState<ExpandedStringifiedPathsByRecord>(
    new Map(),
  );
  const scrollToPath = useCallback((recordId: string, pathText: string) => {
    dispatchSelection({ type: "scrollToPath", recordId, pathText });
  }, []);

  const selectPath = useCallback(
    (selection: SelectedPath, stringifiedPathChain: readonly string[] = []) => {
      dispatchSelection({ type: "selectPath", selection });
      if (stringifiedPathChain.length > 0) {
        setExpandedPaths((current) =>
          addExpandedStringifiedPaths(current, selection.recordId, stringifiedPathChain),
        );
      }
    },
    [],
  );

  const selectNode = useCallback(
    (record: JsonlRecord, row: TreeRow) => selectPath(createSelectionFromRow(record, row)),
    [selectPath],
  );

  const selectRecord = useCallback((record: JsonlRecord) => {
    dispatchSelection({ type: "selectRecord", recordId: record.id });
  }, []);

  const selectAgentDetail = useCallback((selection: AgentDetailSelection) => {
    dispatchSelection({ type: "selectAgentDetail", selection });
  }, []);

  const reset = useCallback(() => {
    dispatchSelection({ type: "resetTransientSelection" });
    setExpandedPaths(new Map());
    setSearchExpandedPaths(new Map());
  }, []);

  const prevVisibleRecordsRef = useRef<readonly JsonlRecord[] | null>(null);
  const reconcileVisibleRecords = useCallback((records: readonly JsonlRecord[]) => {
    const prevRecords = prevVisibleRecordsRef.current;
    if (prevRecords !== null && hasUnchangedArrayPrefix(prevRecords, records)) {
      dispatchSelection({
        type: "recordsAppended",
        firstRecordId: records[0]?.id ?? null,
      });
    } else {
      dispatchSelection({
        type: "recordsVisibilityChanged",
        recordIds: records.map((record) => record.id),
      });
    }
    prevVisibleRecordsRef.current = records;
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
        measurePerfFn("expand:all:collect", () =>
          replaceExpandedStringifiedPathsBatch(
            current,
            records.map(
              (record) =>
                [
                  record.id,
                  collectStringifiedPaths(
                    record,
                    getExpandedStringifiedPaths(displayedExpandedPaths, record.id),
                  ),
                ] as const,
            ),
          ),
        ),
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

  const clearFocus = useCallback(() => dispatchSelection({ type: "clearFocusedPath" }), []);
  const clearScrollIntent = useCallback(() => dispatchSelection({ type: "clearScrollIntent" }), []);
  const reportActiveRecord = useCallback((recordId: string) => {
    dispatchSelection({ type: "activeRecordReported", recordId });
  }, []);

  return {
    state: {
      activeRecordId: selectionState.activeRecordId,
      detailSelection: selectionState.detailSelection,
      expandedPaths,
      searchExpandedPaths,
      selectedPath: selectionState.selectedPath,
      focusedPath: selectionState.focusedPath,
      scrollIntent: selectionState.scrollIntent,
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
    clearScrollIntent,
    reportActiveRecord,
  };
};
