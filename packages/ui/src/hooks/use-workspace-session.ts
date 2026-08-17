import type { JsonlRecord } from "@unquote/core";
import { useCallback } from "react";
import type { AgentDetailSelection } from "../lib/agent-session";
import { markPerf, measurePerfFn } from "../lib/perf";
import type { QueryNavigationTarget } from "../lib/query-navigation";
import {
  addExpandedStringifiedPaths,
  clearExpandedStringifiedPaths,
  getExpandedStringifiedPaths,
  replaceExpandedStringifiedPathsBatch,
  toggleExpandedStringifiedPath,
  type ExpandedStringifiedPathsByRecord,
} from "../lib/record-expansion";
import type { SearchMatch } from "../lib/record-search";
import { belongsToSourceRevision } from "../lib/source-revision";
import type { SourceRevision, SourceRevisionUpdater } from "../lib/source-revision";
import { collectStringifiedPaths } from "../lib/tree";
import type { TreeRow } from "../lib/tree";
import {
  createInitialWorkspaceSelectionState,
  reduceWorkspaceSelection,
} from "../lib/workspace-selection";
import type { SelectedPath, WorkspaceSelectionAction } from "../lib/workspace-selection";
import { useSourceRevisionState } from "./use-source-revision-state";

export type { SelectedPath } from "../lib/workspace-selection";

const createExpandedPaths = (): ExpandedStringifiedPathsByRecord => new Map();

interface WorkspaceSessionValue {
  selection: ReturnType<typeof createInitialWorkspaceSelectionState>;
  expandedPaths: ExpandedStringifiedPathsByRecord;
  searchExpandedPaths: ExpandedStringifiedPathsByRecord;
  searchExpansionSource: readonly SearchMatch[];
}

export const emptyWorkspaceSearchMatches: SearchMatch[] = [];

const createWorkspaceSessionValue = (): WorkspaceSessionValue => ({
  selection: createInitialWorkspaceSelectionState(),
  expandedPaths: createExpandedPaths(),
  searchExpandedPaths: createExpandedPaths(),
  searchExpansionSource: emptyWorkspaceSearchMatches,
});

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
  const [workspaceState, updateWorkspace, replaceWorkspaceForRevision] = useSourceRevisionState(
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
    (updater: SourceRevisionUpdater<ExpandedStringifiedPathsByRecord>) => {
      updateWorkspace((current) => {
        const expandedPaths = updater(current.expandedPaths);
        return expandedPaths === current.expandedPaths ? current : { ...current, expandedPaths };
      });
    },
    [updateWorkspace],
  );
  const setSearchExpandedPaths = useCallback(
    (updater: SourceRevisionUpdater<ExpandedStringifiedPathsByRecord>) => {
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

  const openAgentRecord = useCallback(
    (selection: AgentDetailSelection, recordId: string) => {
      dispatchSelection({ type: "openAgentRecord", selection, recordId });
    },
    [dispatchSelection],
  );

  const commitQueryProjection = useCallback(
    (
      selection: WorkspaceSessionValue["selection"],
      searchExpansionSource: readonly SearchMatch[],
      searchExpandedPaths: ExpandedStringifiedPathsByRecord,
    ) => {
      updateWorkspace((current) => {
        if (
          current.selection === selection &&
          current.searchExpansionSource === searchExpansionSource &&
          current.searchExpandedPaths === searchExpandedPaths
        ) {
          return current;
        }

        return {
          ...current,
          selection,
          searchExpansionSource,
          searchExpandedPaths,
        };
      });
    },
    [updateWorkspace],
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

  const clearScrollIntent = useCallback(
    () => dispatchSelection({ type: "clearScrollIntent" }),
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
      scrollIntent: workspaceState.selection.scrollIntent,
    },
    queryProjectionState: {
      selection: workspaceState.selection,
      searchExpansionSource: workspaceState.searchExpansionSource,
      searchExpandedPaths: workspaceState.searchExpandedPaths,
    },
    navigate,
    selectPath,
    selectNode,
    selectRecord,
    selectAgentDetail,
    openAgentRecord,
    scrollToPath,
    commitQueryProjection,
    setSampleExpansions,
    expandAll,
    collapseAll,
    togglePath,
    clearScrollIntent,
  };
};
