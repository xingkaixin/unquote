import type { JsonlRecord } from "@unquote/core";
import { useCallback, useMemo } from "react";
import type { AgentDetailSelection } from "../lib/agent-session";
import { markPerf, measurePerfFn } from "../lib/perf";
import type { QueryNavigationTarget } from "../lib/query-navigation";
import {
  addExpandedStringifiedPaths,
  collapseExpandedStringifiedPaths,
  getExpandedStringifiedPaths,
  projectExpandedStringifiedPaths,
  replaceExpandedStringifiedPathsBatch,
  type ExpandedStringifiedPathsByRecord,
  type StringifiedExpansionState,
} from "../lib/record-expansion";
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
const noSearchExpandedPaths: ExpandedStringifiedPathsByRecord = new Map();

interface WorkspaceSessionValue extends StringifiedExpansionState {
  selection: ReturnType<typeof createInitialWorkspaceSelectionState>;
}

const createWorkspaceSessionValue = (): WorkspaceSessionValue => ({
  selection: createInitialWorkspaceSelectionState(),
  expandedPaths: createExpandedPaths(),
  searchExpansionSuppressions: new Map(),
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

export const useWorkspaceSession = (
  sourceRevision: SourceRevision,
  searchExpandedPaths: ExpandedStringifiedPathsByRecord = noSearchExpandedPaths,
  searchExpansionRevision = 0,
) => {
  const [workspaceState, updateWorkspace, replaceWorkspaceForRevision] = useSourceRevisionState(
    sourceRevision,
    createWorkspaceSessionValue,
  );
  const { expandedPaths, searchExpansionSuppressions } = workspaceState;
  const displayedExpandedPaths = useMemo(
    () =>
      projectExpandedStringifiedPaths(
        { expandedPaths, searchExpansionSuppressions },
        searchExpandedPaths,
        searchExpansionRevision,
      ),
    [expandedPaths, searchExpandedPaths, searchExpansionRevision, searchExpansionSuppressions],
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
    (records: readonly JsonlRecord[]) => {
      updateWorkspace((current) => {
        const displayedPaths = projectExpandedStringifiedPaths(
          current,
          searchExpandedPaths,
          searchExpansionRevision,
        );
        const expandedPaths = measurePerfFn("expand:all:collect", () =>
          replaceExpandedStringifiedPathsBatch(
            current.expandedPaths,
            records.map(
              (record) =>
                [
                  record.id,
                  collectAllStringifiedPaths(
                    record,
                    getExpandedStringifiedPaths(displayedPaths, record.id),
                  ),
                ] as const,
            ),
          ),
        );
        return expandedPaths === current.expandedPaths ? current : { ...current, expandedPaths };
      });
      markPerf("expand:all:set-state");
    },
    [searchExpandedPaths, searchExpansionRevision, updateWorkspace],
  );

  const collapseAll = useCallback(
    (recordIds: readonly string[]) => {
      updateWorkspace((current) =>
        collapseExpandedStringifiedPaths(
          current,
          recordIds,
          "all",
          searchExpandedPaths,
          searchExpansionRevision,
        ),
      );
    },
    [searchExpandedPaths, searchExpansionRevision, updateWorkspace],
  );

  const togglePath = useCallback(
    (recordId: string, path: string) => {
      markPerf("expand:path");
      updateWorkspace((current) => {
        const displayedPaths = projectExpandedStringifiedPaths(
          current,
          searchExpandedPaths,
          searchExpansionRevision,
        );
        if (getExpandedStringifiedPaths(displayedPaths, recordId).has(path)) {
          return collapseExpandedStringifiedPaths(
            current,
            [recordId],
            new Set([path]),
            searchExpandedPaths,
            searchExpansionRevision,
          );
        }

        return {
          ...current,
          expandedPaths: addExpandedStringifiedPaths(current.expandedPaths, recordId, [path]),
        };
      });
    },
    [searchExpandedPaths, searchExpansionRevision, updateWorkspace],
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
    displayedExpandedPaths,
    state: {
      sourceRevision,
      selection: workspaceState.selection,
      expandedPaths: workspaceState.expandedPaths,
    },
    navigate,
    selectPath,
    selectNode,
    selectRecord,
    selectAgentDetail,
    openAgentRecord,
    scrollToPath,
    setSampleExpansions,
    expandAll,
    collapseAll,
    togglePath,
    clearScrollIntent,
  };
};
