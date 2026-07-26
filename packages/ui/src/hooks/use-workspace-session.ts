import type { JsonlRecord } from "@unquote/core";
import { useCallback, useMemo, useRef, useState } from "react";
import type { AgentDetailSelection } from "../lib/agent-session";
import { hasUnchangedArrayPrefix } from "../lib/partial-record-cache";
import { markPerf, measurePerfFn } from "../lib/perf";
import type { QueryNavigationTarget } from "../lib/query-navigation";
import {
  addExpandedStringifiedPaths,
  clearExpandedStringifiedPaths,
  getExpandedStringifiedPaths,
  groupExpandedStringifiedPaths,
  replaceExpandedStringifiedPathsBatch,
  toggleExpandedStringifiedPath,
  type ExpandedStringifiedPathsByRecord,
} from "../lib/record-expansion";
import type { SearchMatch } from "../lib/record-search";
import { belongsToSourceRevision } from "../lib/source-revision";
import type { SourceRevision, SourceRevisionOwned } from "../lib/source-revision";
import { collectStringifiedPaths } from "../lib/tree";
import type { TreeRow } from "../lib/tree";
import {
  createInitialWorkspaceSelectionState,
  reduceWorkspaceSelection,
} from "../lib/workspace-selection";
import type { SelectedPath, WorkspaceSelectionAction } from "../lib/workspace-selection";

export type { SelectedPath } from "../lib/workspace-selection";

interface RevisionedValue<Value> extends SourceRevisionOwned {
  value: Value;
}

type RevisionedValueUpdater<Value> = (current: Value) => Value;

const createExpandedPaths = (): ExpandedStringifiedPathsByRecord => new Map();

interface WorkspaceSessionValue {
  selection: ReturnType<typeof createInitialWorkspaceSelectionState>;
  expandedPaths: ExpandedStringifiedPathsByRecord;
  searchExpandedPaths: ExpandedStringifiedPathsByRecord;
}

const createWorkspaceSessionValue = (): WorkspaceSessionValue => ({
  selection: createInitialWorkspaceSelectionState(),
  expandedPaths: createExpandedPaths(),
  searchExpandedPaths: createExpandedPaths(),
});

// Sample loading publishes a source and seeds that future revision in one
// batched event. Older callbacks must not overwrite an already newer envelope.
const useRevisionedValue = <Value>(
  sourceRevision: SourceRevision,
  createInitialValue: () => Value,
) => {
  const initialValue = useMemo(createInitialValue, [createInitialValue, sourceRevision]);
  const [storedValue, setStoredValue] = useState<RevisionedValue<Value>>(() => ({
    sourceRevision,
    value: createInitialValue(),
  }));
  const value = belongsToSourceRevision(sourceRevision, storedValue)
    ? storedValue.value
    : initialValue;

  const update = useCallback(
    (updater: RevisionedValueUpdater<Value>) => {
      setStoredValue((current) => {
        if (current.sourceRevision > sourceRevision) {
          return current;
        }

        const currentValue = belongsToSourceRevision(sourceRevision, current)
          ? current.value
          : createInitialValue();
        const nextValue = updater(currentValue);
        if (currentValue === nextValue && belongsToSourceRevision(sourceRevision, current)) {
          return current;
        }

        return { sourceRevision, value: nextValue };
      });
    },
    [createInitialValue, sourceRevision],
  );

  const replaceForRevision = useCallback((revision: SourceRevision, nextValue: Value) => {
    setStoredValue((current) =>
      current.sourceRevision > revision ? current : { sourceRevision: revision, value: nextValue },
    );
  }, []);

  return [value, update, replaceForRevision] as const;
};

const createSelectionFromRow = (record: JsonlRecord, row: TreeRow): SelectedPath => ({
  recordId: record.id,
  pathText: row.pathText,
  rawKey: row.keyLabel,
});

// collectStringifiedPaths only reaches the outermost stringified nodes of the
// currently expanded frontier — descending further needs those paths to already
// be expanded. Expand All means all, so drive it to a fixpoint. The set only
// grows and is bounded by the record's stringified node count, so this
// terminates; in practice it runs once per level of nesting.
const collectAllStringifiedPaths = (record: JsonlRecord, seed: ReadonlySet<string>) => {
  // `frontier` drives how deep the walk may descend; `collected` is the result.
  // Keeping them separate preserves the previous behaviour of dropping seed
  // paths that are no longer reachable in the record.
  const frontier = new Set(seed);
  const collected = new Set<string>();

  for (;;) {
    const sizeBefore = collected.size;
    for (const path of collectStringifiedPaths(record, frontier)) {
      collected.add(path);
      frontier.add(path);
    }
    if (collected.size === sizeBefore) {
      return collected;
    }
  }
};

export const useWorkspaceSession = (sourceRevision: SourceRevision) => {
  const [workspaceState, updateWorkspace, replaceWorkspaceForRevision] = useRevisionedValue(
    sourceRevision,
    createWorkspaceSessionValue,
  );
  const dispatchSelection = useCallback(
    (action: WorkspaceSelectionAction) => {
      updateWorkspace((current) => {
        const selection = reduceWorkspaceSelection(current.selection, action);
        return selection === current.selection ? current : { ...current, selection };
      });
    },
    [updateWorkspace],
  );
  const setExpandedPaths = useCallback(
    (updater: RevisionedValueUpdater<ExpandedStringifiedPathsByRecord>) => {
      updateWorkspace((current) => {
        const expandedPaths = updater(current.expandedPaths);
        return expandedPaths === current.expandedPaths ? current : { ...current, expandedPaths };
      });
    },
    [updateWorkspace],
  );
  const setSearchExpandedPaths = useCallback(
    (updater: RevisionedValueUpdater<ExpandedStringifiedPathsByRecord>) => {
      updateWorkspace((current) => {
        const searchExpandedPaths = updater(current.searchExpandedPaths);
        return searchExpandedPaths === current.searchExpandedPaths
          ? current
          : { ...current, searchExpandedPaths };
      });
    },
    [updateWorkspace],
  );
  const scrollToPath = useCallback(
    (recordId: string, pathText: string) => {
      dispatchSelection({ type: "scrollToPath", recordId, pathText });
    },
    [dispatchSelection],
  );

  const selectPath = useCallback(
    (selection: SelectedPath, stringifiedPathChain: readonly string[] = []) => {
      dispatchSelection({ type: "selectPath", selection });
      if (stringifiedPathChain.length > 0) {
        setExpandedPaths((current) =>
          addExpandedStringifiedPaths(current, selection.recordId, stringifiedPathChain),
        );
      }
    },
    [dispatchSelection, setExpandedPaths],
  );

  const selectNode = useCallback(
    (record: JsonlRecord, row: TreeRow) => selectPath(createSelectionFromRow(record, row)),
    [selectPath],
  );

  const selectRecord = useCallback(
    (record: JsonlRecord) => {
      dispatchSelection({ type: "selectRecord", recordId: record.id });
    },
    [dispatchSelection],
  );

  const selectAgentDetail = useCallback(
    (selection: AgentDetailSelection) => {
      dispatchSelection({ type: "selectAgentDetail", selection });
    },
    [dispatchSelection],
  );

  const prevVisibleRecordsRef = useRef<RevisionedValue<readonly JsonlRecord[]> | null>(null);
  const reconcileVisibleRecords = useCallback(
    (records: readonly JsonlRecord[]) => {
      const previous = prevVisibleRecordsRef.current;
      if (previous && previous.sourceRevision > sourceRevision) {
        return;
      }

      const prevRecords =
        previous && belongsToSourceRevision(sourceRevision, previous) ? previous.value : null;
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
      prevVisibleRecordsRef.current = { sourceRevision, value: records };
    },
    [dispatchSelection, sourceRevision],
  );

  const synchronizeSearchExpansions = useCallback(
    (matches: readonly SearchMatch[]) => {
      const groupedPaths = groupExpandedStringifiedPaths(matches);
      setSearchExpandedPaths(() => groupedPaths);
    },
    [setSearchExpandedPaths],
  );

  const setSampleExpansions = useCallback(
    (
      revision: SourceRevision,
      entries: readonly { recordId: string; paths: readonly string[] }[],
    ) => {
      replaceWorkspaceForRevision(revision, {
        ...createWorkspaceSessionValue(),
        expandedPaths: new Map(entries.map(({ recordId, paths }) => [recordId, new Set(paths)])),
      });
    },
    [replaceWorkspaceForRevision],
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
                  collectAllStringifiedPaths(
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
    [setExpandedPaths],
  );

  const collapseAll = useCallback(
    (recordIds: readonly string[]) => {
      setExpandedPaths((current) => clearExpandedStringifiedPaths(current, recordIds));
      setSearchExpandedPaths((current) => clearExpandedStringifiedPaths(current, recordIds));
    },
    [setExpandedPaths, setSearchExpandedPaths],
  );

  const togglePath = useCallback(
    (recordId: string, path: string) => {
      markPerf("expand:path");
      setExpandedPaths((current) => toggleExpandedStringifiedPath(current, recordId, path));
    },
    [setExpandedPaths],
  );

  const clearFocus = useCallback(
    () => dispatchSelection({ type: "clearFocusedPath" }),
    [dispatchSelection],
  );
  const clearScrollIntent = useCallback(
    () => dispatchSelection({ type: "clearScrollIntent" }),
    [dispatchSelection],
  );
  const reportActiveRecord = useCallback(
    (recordId: string) => {
      dispatchSelection({ type: "activeRecordReported", recordId });
    },
    [dispatchSelection],
  );
  const navigate = useCallback(
    (navigation: QueryNavigationTarget) => {
      if (!belongsToSourceRevision(sourceRevision, navigation)) {
        return;
      }

      if (navigation.kind === "clear") {
        clearScrollIntent();
        return;
      }

      if (navigation.kind === "search") {
        scrollToPath(navigation.recordId, navigation.pathText);
        return;
      }

      selectPath(
        {
          recordId: navigation.target.recordId,
          pathText: navigation.target.pathText,
          rawKey: navigation.target.rawKey,
        },
        navigation.target.stringifiedPathChain,
      );
    },
    [clearScrollIntent, scrollToPath, selectPath, sourceRevision],
  );

  return {
    state: {
      sourceRevision,
      activeRecordId: workspaceState.selection.activeRecordId,
      detailSelection: workspaceState.selection.detailSelection,
      expandedPaths: workspaceState.expandedPaths,
      searchExpandedPaths: workspaceState.searchExpandedPaths,
      selectedPath: workspaceState.selection.selectedPath,
      focusedPath: workspaceState.selection.focusedPath,
      scrollIntent: workspaceState.selection.scrollIntent,
    },
    navigate,
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
