import type { JsonlRecord } from "@unquote/core";
import { useEffect } from "react";
import type { SearchMatch } from "../lib/record-search";
import type { RecordAppend } from "../lib/record-sequence";

interface QueryBindingSnapshot {
  activeSearchMatch: SearchMatch | null;
  visibleMatches: readonly SearchMatch[] | null;
  visibleRecords: readonly JsonlRecord[];
  visibleRecordAppend: RecordAppend | null;
}

interface QueryBindingWorkspace {
  synchronizeSearchExpansions: (matches: readonly SearchMatch[]) => void;
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

  useEffect(() => {
    workspace.synchronizeSearchExpansions(visibleMatches ?? []);
  }, [visibleMatches, workspace.synchronizeSearchExpansions]);

  useEffect(() => {
    workspace.reconcileVisibleRecords(visibleRecords, visibleRecordAppend);
  }, [visibleRecordAppend, visibleRecords, workspace.reconcileVisibleRecords]);

  return activeSearchMatch;
};
