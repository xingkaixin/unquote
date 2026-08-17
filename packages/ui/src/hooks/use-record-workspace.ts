import type { ParseResult } from "@unquote/core";
import { toast } from "sonner";
import { useCallback, useMemo } from "react";
import type { RecordWorkspaceModel } from "../components/record-workspace";
import { useTranslation } from "../i18n/context";
import type { AgentDetailSelection, AgentSession } from "../lib/agent-session";
import { resolveSourceWork } from "../lib/published-source";
import type { SourceWorkProjection } from "../lib/published-source";
import {
  getExpandedStringifiedPaths,
  groupExpandedStringifiedPaths,
  mergeExpandedStringifiedPaths,
} from "../lib/record-expansion";
import { isCopyRecordCountAboveThreshold } from "../lib/record-export";
import { recordContainsStringifiedJson } from "../lib/record-filter";
import type { NestedFilterScope } from "../lib/record-filter";
import type { RecordAppend } from "../lib/record-sequence";
import type { RecordViewActions } from "../lib/record-view";
import { narrowPathToRecord } from "../lib/record-view";
import type { SearchMatch } from "../lib/record-search";
import { projectSelectedNode } from "../lib/selected-node";
import type { SourceRevision } from "../lib/source-revision";
import { reconcileWorkspaceSelection, reduceWorkspaceSelection } from "../lib/workspace-selection";
import type {
  WorkspaceSelectionState,
  WorkspaceSelectionVisibility,
} from "../lib/workspace-selection";
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
  visibility: WorkspaceSelectionVisibility,
  recordAppend: RecordAppend | null,
) =>
  recordAppend
    ? reduceWorkspaceSelection(selection, {
        type: "recordsAppended",
        firstRecordId: visibility.firstRecordId,
      })
    : reconcileWorkspaceSelection(selection, visibility);

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
    () => projectSelection(selection, selectionVisibility, visibleRecordAppend),
    [selection, selectionVisibility, visibleRecordAppend],
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
  const openAgentRecord = useCallback(
    (selection: AgentDetailSelection, recordId: string) => {
      if (!recordsById.has(recordId)) {
        return;
      }
      workspace.openAgentRecord(selection, recordId);
    },
    [recordsById, workspace.openAgentRecord],
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
        searchMatches: visibleMatchesByRecord.get(displayedRecordId) ?? emptyWorkspaceSearchMatches,
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
    openAgentRecord,
    selectRecordById,
    setSampleExpansions: workspace.setSampleExpansions,
    resolveRecord: localFileSource.resolveRecord,
    requestFullRecord: localFileSource.requestFullRecord,
  };
};
