import type { JsonlRecord } from "@unquote/core";
import { useEffect } from "react";
import { isPathWithin } from "../lib/path-codec";
import type { SearchMatch } from "../lib/record-search";
import type { RecordAppend } from "../lib/record-sequence";
import type { FocusedPath } from "../lib/workspace-selection";

interface QueryBindingSnapshot {
  activeSearchMatch: SearchMatch | null;
  visibleMatches: readonly SearchMatch[] | null;
  visibleRecords: readonly JsonlRecord[];
  visibleRecordAppend: RecordAppend | null;
}

interface QueryBindingWorkspace {
  state: { focusedPath: FocusedPath | null };
  synchronizeSearchExpansions: (matches: readonly SearchMatch[]) => void;
  clearFocus: () => void;
  reconcileVisibleRecords: (
    records: readonly JsonlRecord[],
    recordAppend?: RecordAppend | null,
  ) => void;
}

interface UseWorkspaceQueryBindingParams {
  query: QueryBindingSnapshot;
  workspace: QueryBindingWorkspace;
}

export const useWorkspaceQueryBinding = ({ query, workspace }: UseWorkspaceQueryBindingParams) => {
  const { activeSearchMatch, visibleMatches, visibleRecords, visibleRecordAppend } = query;
  const { focusedPath } = workspace.state;

  useEffect(() => {
    workspace.synchronizeSearchExpansions(visibleMatches ?? []);
  }, [visibleMatches, workspace.synchronizeSearchExpansions]);

  useEffect(() => {
    if (
      !focusedPath ||
      !activeSearchMatch ||
      (focusedPath.recordId === activeSearchMatch.recordId &&
        isPathWithin(activeSearchMatch.pathText, focusedPath.pathText))
    ) {
      return;
    }

    workspace.clearFocus();
  }, [activeSearchMatch, focusedPath, workspace.clearFocus]);

  useEffect(() => {
    workspace.reconcileVisibleRecords(visibleRecords, visibleRecordAppend);
  }, [visibleRecordAppend, visibleRecords, workspace.reconcileVisibleRecords]);

  return activeSearchMatch;
};
