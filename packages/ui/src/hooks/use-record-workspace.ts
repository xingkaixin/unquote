import type { ParseResult } from "@unquote/core";
import { toast } from "sonner";
import { useCallback, useLayoutEffect, useMemo } from "react";
import { useTranslation } from "../i18n/context";
import type { AgentDetailSelection, AgentSession } from "../lib/agent-session";
import { resolveSourceWork } from "../lib/published-source";
import type { PublishedSourceRevision } from "../lib/published-source";
import {
  getExpandedStringifiedPaths,
  groupExpandedStringifiedPaths,
  mergeExpandedStringifiedPaths,
} from "../lib/record-expansion";
import type { ExpandedStringifiedPathsByRecord } from "../lib/record-expansion";
import { isCopyRecordCountAboveThreshold } from "../lib/record-export";
import { recordContainsStringifiedJson } from "../lib/record-filter";
import type { NestedFilterScope } from "../lib/record-filter";
import type { RecordAppend } from "../lib/record-sequence";
import type { RecordViewActions } from "../lib/record-view";
import { narrowPathToRecord } from "../lib/record-view";
import type { SearchMatch } from "../lib/record-search";
import type { RecordWorkspaceModel } from "../lib/record-workspace-model";
import { projectSelectedNode } from "../lib/selected-node";
import type { SourceRevision } from "../lib/source-revision";
import { projectWorkspaceSelection } from "../lib/workspace-selection";
import type { WorkspaceSelectionVisibility } from "../lib/workspace-selection";
import { useExportActions } from "./use-export-actions";
import { useLocalFileSource } from "./use-local-file-source";
import { useQueryInteraction } from "./use-query-interaction";
import { useWorkspaceSession } from "./use-workspace-session";

const emptySearchMatches: SearchMatch[] = [];

const applySearchExpansionSuppressions = (
  paths: ExpandedStringifiedPathsByRecord,
  suppressions: ReadonlyMap<string, number>,
  searchExpansionRevision: number,
) => {
  let projected: Map<string, ReadonlySet<string>> | null = null;
  for (const [recordId, suppressedRevision] of suppressions) {
    if (suppressedRevision !== searchExpansionRevision || !paths.has(recordId)) {
      continue;
    }
    projected ??= new Map(paths);
    projected.delete(recordId);
  }
  return projected ?? paths;
};

interface UseRecordWorkspaceParams {
  source: PublishedSourceRevision;
  resultRevision: SourceRevision;
  result: ParseResult;
  recordAppend: RecordAppend | null;
  agentSession: AgentSession | null;
  translateError: (reason: "invalid" | "not-found") => string;
}

export const useRecordWorkspace = ({
  source,
  resultRevision,
  result,
  recordAppend,
  agentSession,
  translateError,
}: UseRecordWorkspaceParams) => {
  const { t } = useTranslation();
  const { sourceAccess, sourceRevision } = resolveSourceWork(source);
  const workspace = useWorkspaceSession(sourceRevision);
  const query = useQueryInteraction({
    source,
    resultRevision,
    result,
    recordAppend,
    translateError,
  });
  const localFileSource = useLocalFileSource(sourceAccess, sourceRevision);
  const {
    activeSearchMatch,
    recordInsights,
    recordsById,
    visibleRecords,
    visibleRecordAppend,
    visibleStats,
    visibleMatches,
  } = query.snapshot;
  const queryMatches = visibleMatches ?? emptySearchMatches;
  const selectionVisibility = useMemo<WorkspaceSelectionVisibility>(
    () => ({
      firstRecordId: visibleRecords[0]?.id ?? null,
      recordIds:
        query.snapshot.recordFilter === "all"
          ? recordsById
          : new Set(visibleRecords.map((record) => record.id)),
    }),
    [query.snapshot.recordFilter, recordsById, visibleRecords],
  );
  const projectedSelection = useMemo(
    () =>
      projectWorkspaceSelection(
        workspace.state.selection,
        selectionVisibility,
        visibleRecordAppend,
      ),
    [selectionVisibility, visibleRecordAppend, workspace.state.selection],
  );
  const groupedSearchExpandedPaths = useMemo(
    () => groupExpandedStringifiedPaths(queryMatches),
    [queryMatches],
  );
  const projectedSearchExpandedPaths = useMemo(
    () =>
      applySearchExpansionSuppressions(
        groupedSearchExpandedPaths,
        workspace.state.searchExpansionSuppressions,
        query.searchExpansionRevision,
      ),
    [
      groupedSearchExpandedPaths,
      query.searchExpansionRevision,
      workspace.state.searchExpansionSuppressions,
    ],
  );
  useLayoutEffect(() => {
    if (query.navigation) {
      workspace.navigate(query.navigation.target);
    }
  }, [query.navigation, workspace.navigate]);
  const displayedExpandedPaths = useMemo(
    () =>
      mergeExpandedStringifiedPaths(workspace.state.expandedPaths, projectedSearchExpandedPaths),
    [projectedSearchExpandedPaths, workspace.state.expandedPaths],
  );
  const activeRecord = projectedSelection.activeRecordId
    ? (recordsById.get(projectedSelection.activeRecordId) ?? null)
    : null;
  const displayedRecordId = activeRecord?.id ?? "";
  const resolveRecordById = useCallback(
    (recordId: string) => {
      const record = recordsById.get(recordId);
      return record ? localFileSource.resolveRecord(record) : null;
    },
    [localFileSource.resolveRecord, recordsById],
  );
  const requestFullRecordById = useCallback(
    (recordId: string) => {
      const record = recordsById.get(recordId);
      if (record) {
        localFileSource.requestFullRecord(record);
      }
    },
    [localFileSource.requestFullRecord, recordsById],
  );
  const renderedActiveRecord = useMemo(
    () => (activeRecord ? resolveRecordById(activeRecord.id) : null),
    [activeRecord, resolveRecordById],
  );
  const activeRecordHasNestedJson = useMemo(
    () => Boolean(renderedActiveRecord && recordContainsStringifiedJson(renderedActiveRecord)),
    [renderedActiveRecord],
  );
  const selectedNode = useMemo(
    () => projectSelectedNode(renderedActiveRecord, projectedSelection.selectedPath),
    [projectedSelection.selectedPath, renderedActiveRecord],
  );
  const expandedNestedCount = getExpandedStringifiedPaths(
    displayedExpandedPaths,
    displayedRecordId,
  ).size;
  const turnIndexByRecordId = useMemo(() => {
    if (!agentSession) {
      return null;
    }

    const turnIndexes = new Map<string, number>();
    for (const event of agentSession.events) {
      if (event.turnIndex !== undefined && !turnIndexes.has(event.recordId)) {
        turnIndexes.set(event.recordId, event.turnIndex);
      }
    }
    return turnIndexes;
  }, [agentSession]);
  const visibleMatchesByRecord = useMemo(() => {
    const matchesByRecord = new Map<string, SearchMatch[]>();
    for (const match of queryMatches) {
      const matches = matchesByRecord.get(match.recordId);
      if (matches) {
        matches.push(match);
      } else {
        matchesByRecord.set(match.recordId, [match]);
      }
    }
    return matchesByRecord;
  }, [queryMatches]);
  const isCopyBlocked = isCopyRecordCountAboveThreshold(visibleRecords.length);
  const nestedFilterScope: NestedFilterScope =
    query.snapshot.fileOverview.structurePrecision === "exact" ? "all-levels" : "top-level";
  const exportActions = useExportActions({
    visibleRecords,
    resolveRecords: localFileSource.resolveRecords,
    sourceAccess,
    format: result.format,
    isCopyBlocked,
    sourceRevision,
  });
  const recordView = useMemo<RecordViewActions>(
    () => ({
      togglePath: workspace.togglePath,
      copyRecord: exportActions.onCopyRecord,
      copyRawLine: exportActions.onCopyRawLine,
      copyError: exportActions.onCopyRecordError,
      selectNode: workspace.selectNode,
      requestFullRecord: localFileSource.requestFullRecord,
    }),
    [
      exportActions.onCopyRawLine,
      exportActions.onCopyRecord,
      exportActions.onCopyRecordError,
      localFileSource.requestFullRecord,
      workspace.selectNode,
      workspace.togglePath,
    ],
  );
  const expandAll = useCallback(() => {
    workspace.expandAll(renderedActiveRecord ? [renderedActiveRecord] : [], displayedExpandedPaths);
  }, [displayedExpandedPaths, renderedActiveRecord, workspace.expandAll]);
  const collapseAll = useCallback(() => {
    const recordIds = activeRecord ? [activeRecord.id] : [];
    const searchExpansionRevision =
      activeRecord && groupedSearchExpandedPaths.has(activeRecord.id)
        ? query.searchExpansionRevision
        : null;
    workspace.collapseAll(recordIds, searchExpansionRevision);
  }, [
    activeRecord,
    groupedSearchExpandedPaths,
    query.searchExpansionRevision,
    workspace.collapseAll,
  ]);
  const copySelectedValue = useCallback(() => {
    const selectedNodeCopy = selectedNode.copy;
    if (selectedNodeCopy.kind === "blocked") {
      if (selectedNode.kind === "too-large" || selectedNode.kind === "value") {
        toast.warning(t("inspector.copyBlocked"));
      }
      return;
    }

    return exportActions.copyText(() => selectedNodeCopy.format());
  }, [exportActions.copyText, selectedNode, t]);
  const copySelectedPath = useCallback(
    () => exportActions.copyText(async () => projectedSelection.selectedPath?.pathText ?? null),
    [exportActions.copyText, projectedSelection.selectedPath],
  );
  const selectRecordById = useCallback(
    (recordId: string) => {
      const record = recordsById.get(recordId);
      if (record) {
        workspace.selectRecord(record);
      }
    },
    [recordsById, workspace.selectRecord],
  );
  const openAgentRecord = useCallback(
    (selection: AgentDetailSelection, recordId: string, options?: { reveal: boolean }) => {
      if (!recordsById.has(recordId)) {
        return false;
      }
      if (options?.reveal) {
        query.intent.revealAllRecords();
      }
      workspace.openAgentRecord(selection, recordId);
      return true;
    },
    [query.intent.revealAllRecords, recordsById, workspace.openAgentRecord],
  );
  const model = useMemo<RecordWorkspaceModel>(
    () => ({
      filter: {
        mode: query.snapshot.recordFilter,
        shown: visibleStats.total,
        total: result.stats.total,
        nestedScope: nestedFilterScope,
      },
      records: {
        visible: visibleRecords,
        insights: recordInsights,
        turnIndexByRecordId,
      },
      active: {
        id: displayedRecordId,
        record: renderedActiveRecord,
        expandedStringifiedPaths: getExpandedStringifiedPaths(
          displayedExpandedPaths,
          displayedRecordId,
        ),
        searchMatches: visibleMatchesByRecord.get(displayedRecordId) ?? emptySearchMatches,
        activeMatchPath: narrowPathToRecord(activeSearchMatch, displayedRecordId),
        selectedPath: narrowPathToRecord(projectedSelection.selectedPath, displayedRecordId),
        selectedNode,
        expandedNestedCount,
        hasNestedJson: activeRecordHasNestedJson,
      },
      scrollIntent: projectedSelection.scrollIntent,
      intent: {
        setFilter: query.intent.setFilter,
        selectRecord: workspace.selectRecord,
        recordView,
        expandAll,
        collapseAll,
        copySelectedValue,
        copySelectedPath,
      },
    }),
    [
      activeSearchMatch,
      activeRecordHasNestedJson,
      collapseAll,
      copySelectedPath,
      copySelectedValue,
      displayedExpandedPaths,
      displayedRecordId,
      expandAll,
      projectedSelection.scrollIntent,
      projectedSelection.selectedPath,
      query.intent.setFilter,
      query.snapshot.recordFilter,
      nestedFilterScope,
      recordInsights,
      recordView,
      renderedActiveRecord,
      result.stats.total,
      selectedNode,
      turnIndexByRecordId,
      visibleMatchesByRecord,
      visibleRecords,
      visibleStats.total,
      workspace.selectRecord,
    ],
  );

  return {
    model,
    query,
    exportActions,
    isCopyBlocked,
    detailSelection: projectedSelection.detailSelection,
    selectAgentDetail: workspace.selectAgentDetail,
    openAgentRecord,
    selectRecordById,
    setSampleExpansions: workspace.setSampleExpansions,
    resolveRecordById,
    requestFullRecordById,
  };
};
