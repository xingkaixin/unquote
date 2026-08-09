import type { ParseResult } from "@unquote/core";
import { toast } from "sonner";
import { useCallback, useMemo } from "react";
import type { RecordWorkspaceModel } from "../components/record-workspace";
import { useTranslation } from "../i18n/context";
import type { AgentSession } from "../lib/agent-session";
import { resolveSourceWork } from "../lib/published-source";
import type { SourceWorkProjection } from "../lib/published-source";
import {
  getExpandedStringifiedPaths,
  groupExpandedStringifiedPaths,
  mergeExpandedStringifiedPaths,
} from "../lib/record-expansion";
import { isCopyAboveThreshold } from "../lib/record-export";
import type { RecordAppend } from "../lib/record-sequence";
import type { RecordViewActions } from "../lib/record-view";
import { narrowPathToRecord } from "../lib/record-view";
import type { SearchMatch } from "../lib/record-search";
import { projectSelectedNode } from "../lib/selected-node";
import type { SourceRevision } from "../lib/source-revision";
import { reconcileWorkspaceSelection, reduceWorkspaceSelection } from "../lib/workspace-selection";
import type { WorkspaceSelectionState } from "../lib/workspace-selection";
import { useExportActions } from "./use-export-actions";
import { useLocalFileSource } from "./use-local-file-source";
import { useQueryInteraction } from "./use-query-interaction";
import { emptyWorkspaceSearchMatches, useWorkspaceSession } from "./use-workspace-session";

interface UseRecordWorkspaceParams {
  source: SourceWorkProjection;
  resultRevision: SourceRevision;
  result: ParseResult;
  recordAppend: RecordAppend | null;
  agentSession: AgentSession | null;
  translateError: (reason: "invalid" | "not-found") => string;
}

const projectSelection = (
  selection: WorkspaceSelectionState,
  visibleRecords: ParseResult["records"],
  recordAppend: RecordAppend | null,
) =>
  recordAppend
    ? reduceWorkspaceSelection(selection, {
        type: "recordsAppended",
        firstRecordId: visibleRecords[0]?.id ?? null,
      })
    : reconcileWorkspaceSelection(
        selection,
        visibleRecords.map((record) => record.id),
      );

export const useRecordWorkspace = ({
  source,
  resultRevision,
  result,
  recordAppend,
  agentSession,
  translateError,
}: UseRecordWorkspaceParams) => {
  const { t } = useTranslation();
  const { text: sourceText, sourceAccess, sourceRevision } = resolveSourceWork(source);
  const workspace = useWorkspaceSession(sourceRevision);
  const query = useQueryInteraction({
    source,
    resultRevision,
    result,
    recordAppend,
    translateError,
    onNavigate: workspace.navigate,
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
  const queryMatches = visibleMatches ?? emptyWorkspaceSearchMatches;
  const { selection, searchExpansionSource, searchExpandedPaths } = workspace.queryProjectionState;
  const projectedSelection = useMemo(
    () => projectSelection(selection, visibleRecords, visibleRecordAppend),
    [selection, visibleRecordAppend, visibleRecords],
  );
  const groupedSearchExpandedPaths = useMemo(
    () => groupExpandedStringifiedPaths(queryMatches),
    [queryMatches],
  );
  const projectedSearchExpandedPaths =
    searchExpansionSource === queryMatches ? searchExpandedPaths : groupedSearchExpandedPaths;
  const displayedExpandedPaths = useMemo(
    () =>
      mergeExpandedStringifiedPaths(workspace.state.expandedPaths, projectedSearchExpandedPaths),
    [projectedSearchExpandedPaths, workspace.state.expandedPaths],
  );
  const activeRecord = projectedSelection.activeRecordId
    ? (recordsById.get(projectedSelection.activeRecordId) ?? null)
    : null;
  const displayedRecordId = activeRecord?.id ?? "";
  const renderedActiveRecord = useMemo(
    () => (activeRecord ? localFileSource.resolveRecord(activeRecord) : null),
    [activeRecord, localFileSource.resolveRecord],
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
  const isCopyBlocked = isCopyAboveThreshold(
    visibleRecords.length,
    sourceAccess?.size ?? sourceText.length,
  );
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
    workspace.collapseAll(activeRecord ? [activeRecord.id] : []);
  }, [activeRecord, workspace.collapseAll]);
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
  const model = useMemo<RecordWorkspaceModel>(
    () => ({
      filter: {
        mode: query.snapshot.recordFilter,
        shown: visibleStats.total,
        total: result.stats.total,
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
        searchMatches: visibleMatchesByRecord.get(displayedRecordId) ?? emptyWorkspaceSearchMatches,
        activeMatchPath: narrowPathToRecord(activeSearchMatch, displayedRecordId),
        selectedPath: narrowPathToRecord(projectedSelection.selectedPath, displayedRecordId),
        selectedNode,
        expandedNestedCount,
        hasNestedJson: (recordInsights.get(displayedRecordId)?.nestedJsonCount ?? 0) > 0,
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

  if (
    projectedSelection !== selection ||
    searchExpansionSource !== queryMatches ||
    projectedSearchExpandedPaths !== searchExpandedPaths
  ) {
    // React restarts this component before committing its children, so no pane
    // can observe a stale selection paired with a new visible Record set.
    workspace.commitQueryProjection(projectedSelection, queryMatches, projectedSearchExpandedPaths);
  }

  return {
    model,
    query,
    exportActions,
    isCopyBlocked,
    expandedNestedCount,
    hasSelectedPath: projectedSelection.selectedPath !== null,
    copySelectedValue,
    detailSelection: projectedSelection.detailSelection,
    selectAgentDetail: workspace.selectAgentDetail,
    selectRecordById,
    setSampleExpansions: workspace.setSampleExpansions,
  };
};
