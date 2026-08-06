import type { JsonlRecord, ParseResult } from "@unquote/core";
import { useCallback, useEffect, useMemo, useReducer } from "react";
import {
  createInitialQueryInteractionState,
  isPathLikeQuery,
  reconcileMatchIndex,
  reduceQueryInteraction,
} from "../lib/query-interaction";
import type {
  PathResolution,
  QueryInteractionAction,
  QueryInteractionState,
  SearchOptionKind,
} from "../lib/query-interaction";
import type { QueryNavigationTarget } from "../lib/query-navigation";
import type { LocalFileAccess } from "../lib/local-file-source";
import type { SearchOptions } from "../lib/record-search";
import type { RecordAppend } from "../lib/record-sequence";
import { shareSourceRevision } from "../lib/source-revision";
import type { SourceRevision } from "../lib/source-revision";
import { resolveTreePath, resolveTreePathMatches } from "../lib/tree-path";
import type { TreePathMatch } from "../lib/tree-path";
import { useRecordPipeline } from "./use-record-pipeline";
import { useSearchWorker } from "./use-search-worker";

export const memorySearchDebounceMs = 120;
export const localFileSearchDebounceMs = 250;
const emptyPathMatches: TreePathMatch[] = [];

export type { QueryNavigationTarget } from "../lib/query-navigation";

interface UseQueryInteractionOptions {
  sourceRevision: SourceRevision;
  resultRevision: SourceRevision;
  result: ParseResult;
  sourceText: string;
  sourceAccess: LocalFileAccess | null;
  forcedFormat: "json" | "jsonl" | undefined;
  translateError: (reason: "invalid" | "not-found") => string;
  onNavigate: (target: QueryNavigationTarget) => void;
  recordAppend?: RecordAppend | null;
}

interface RevisionedQueryState {
  sourceRevision: SourceRevision;
  state: QueryInteractionState;
}

interface RevisionedQueryAction {
  sourceRevision: SourceRevision;
  action: QueryInteractionAction;
}

const createRevisionedQueryState = (sourceRevision: SourceRevision): RevisionedQueryState => ({
  sourceRevision,
  state: createInitialQueryInteractionState(),
});

const reduceRevisionedQueryState = (
  current: RevisionedQueryState,
  envelope: RevisionedQueryAction,
): RevisionedQueryState => ({
  sourceRevision: envelope.sourceRevision,
  state: reduceQueryInteraction(
    current.sourceRevision === envelope.sourceRevision
      ? current.state
      : createInitialQueryInteractionState(),
    envelope.action,
  ),
});

export const useQueryInteraction = ({
  sourceRevision,
  resultRevision,
  result,
  sourceText,
  sourceAccess,
  forcedFormat,
  translateError,
  onNavigate,
  recordAppend = null,
}: UseQueryInteractionOptions) => {
  const [storedQuery, dispatchToRevision] = useReducer(
    reduceRevisionedQueryState,
    sourceRevision,
    createRevisionedQueryState,
  );
  const initialState = useMemo(createInitialQueryInteractionState, [sourceRevision]);
  const state = storedQuery.sourceRevision === sourceRevision ? storedQuery.state : initialState;
  const dispatch = useCallback(
    (action: QueryInteractionAction) => dispatchToRevision({ sourceRevision, action }),
    [sourceRevision],
  );
  const resolvePathQuery = useCallback(
    (records: JsonlRecord[], value: string): PathResolution | null => {
      const query = value.trim();
      if (!query || !isPathLikeQuery(query)) {
        return null;
      }

      const resolution = resolveTreePathMatches(records, query);
      return resolution.ok
        ? { query, ok: true, targets: resolution.targets }
        : { query, ok: false, error: translateError(resolution.reason) };
    },
    [translateError],
  );

  const mode = state.modeState.mode;
  const searchQuery = mode === "search" ? state.modeState.query : "";
  const pathError = mode === "path" ? state.modeState.error : null;
  const pathMatches = mode === "path" ? state.modeState.matches : emptyPathMatches;
  const currentPathMatchIndex = mode === "path" ? state.modeState.currentIndex : 0;
  const searchOptions = useMemo<SearchOptions>(
    () => ({
      regex: state.searchRegex,
      caseSensitive: state.searchCaseSensitive,
      jq: state.searchJq,
    }),
    [state.searchCaseSensitive, state.searchJq, state.searchRegex],
  );
  const searchWorker = useSearchWorker({
    text: sourceText,
    sourceAccess,
    query: searchQuery,
    options: searchOptions,
    sourceRevision,
    debounceMs: sourceAccess ? localFileSearchDebounceMs : memorySearchDebounceMs,
    ...(forcedFormat ? { forcedFormat } : {}),
  });
  const revisionsAligned = shareSourceRevision(
    sourceRevision,
    { sourceRevision: resultRevision },
    searchWorker,
  );
  const pipeline = useRecordPipeline({
    sourceRevision,
    result,
    searchMatches: revisionsAligned ? searchWorker.matches : null,
    recordFilter: state.recordFilter,
    recordAppend,
  });

  const currentMatchIndex = reconcileMatchIndex(
    mode === "search" ? state.modeState.currentMatchIndex : 0,
    pipeline.matchCount,
  );

  const activeSearchMatch =
    mode === "search"
      ? (pipeline.visibleMatches?.[currentMatchIndex] ?? pipeline.visibleMatches?.[0] ?? null)
      : null;
  const activeSearchRecordId = activeSearchMatch?.recordId ?? null;
  const activeSearchPathText = activeSearchMatch?.pathText ?? null;

  useEffect(() => {
    if (!activeSearchRecordId || !activeSearchPathText) {
      return;
    }

    onNavigate({
      sourceRevision,
      kind: "search",
      recordId: activeSearchRecordId,
      pathText: activeSearchPathText,
    });
  }, [activeSearchPathText, activeSearchRecordId, currentMatchIndex, onNavigate, sourceRevision]);

  const invalidateNavigation = useCallback(
    () => onNavigate({ sourceRevision, kind: "clear" }),
    [onNavigate, sourceRevision],
  );

  const navigate = useCallback(
    (action: QueryInteractionAction) => {
      const reconciledState =
        state.modeState.mode !== "search" || currentMatchIndex === state.modeState.currentMatchIndex
          ? state
          : {
              ...state,
              modeState: { ...state.modeState, currentMatchIndex },
            };
      const nextState = reduceQueryInteraction(reconciledState, action);
      dispatch(action);

      if (nextState.modeState.mode === "path") {
        const match =
          nextState.modeState.matches[nextState.modeState.currentIndex] ??
          nextState.modeState.matches[0];
        const record = match ? pipeline.recordsById.get(match.recordId) : undefined;
        const resolved = match && record ? resolveTreePath([record], match.pathText) : null;
        if (resolved?.ok) {
          onNavigate({ sourceRevision, kind: "path", target: resolved.target });
        }
        return;
      }

      if (
        nextState.modeState.mode === "search" &&
        nextState.modeState.currentMatchIndex === currentMatchIndex &&
        activeSearchRecordId &&
        activeSearchPathText
      ) {
        onNavigate({
          sourceRevision,
          kind: "search",
          recordId: activeSearchRecordId,
          pathText: activeSearchPathText,
        });
      }
    },
    [
      activeSearchPathText,
      activeSearchRecordId,
      currentMatchIndex,
      onNavigate,
      pipeline.recordsById,
      sourceRevision,
      state,
    ],
  );

  const changeToolbarQuery = useCallback(
    (value: string) => {
      invalidateNavigation();
      dispatch({ type: "toolbarQueryChange", value });
    },
    [invalidateNavigation],
  );
  const submitToolbarQuery = useCallback(
    (value: string) => {
      invalidateNavigation();
      const resolution = resolvePathQuery(pipeline.visibleRecords, value);
      navigate({
        type: "submitToolbarQuery",
        value,
        resolution,
      });
    },
    [invalidateNavigation, navigate, pipeline.visibleRecords, resolvePathQuery],
  );
  const clearToolbarQuery = useCallback(() => {
    invalidateNavigation();
    dispatch({ type: "clearToolbarQuery" });
  }, [invalidateNavigation]);
  const searchFromCommand = useCallback(
    (value: string) => {
      invalidateNavigation();
      dispatch({ type: "commandSearch", value });
    },
    [invalidateNavigation],
  );
  const setOption = useCallback(
    (kind: SearchOptionKind, on: boolean) => {
      invalidateNavigation();
      dispatch({ type: "setSearchOption", kind, on });
    },
    [invalidateNavigation],
  );
  const setFilter = useCallback(
    (filter: QueryInteractionState["recordFilter"]) => {
      invalidateNavigation();
      dispatch({ type: "setRecordFilter", filter });
    },
    [invalidateNavigation],
  );
  const changeCommandInput = useCallback(
    (value: string) => dispatch({ type: "setCommandInput", value }),
    [dispatch],
  );
  const prepareCommandInput = useCallback(() => dispatch({ type: "seedCommandInput" }), [dispatch]);
  const previousResult = useCallback(
    () =>
      mode === "path"
        ? navigate({ type: "prevPathMatch" })
        : navigate({ type: "prevMatch", matchCount: pipeline.matchCount }),
    [mode, navigate, pipeline.matchCount],
  );
  const nextResult = useCallback(
    () =>
      mode === "path"
        ? navigate({ type: "nextPathMatch" })
        : navigate({ type: "nextMatch", matchCount: pipeline.matchCount }),
    [mode, navigate, pipeline.matchCount],
  );
  const reset = useCallback(() => dispatch({ type: "resetAll" }), [dispatch]);

  const intent = useMemo(
    () => ({
      changeToolbarQuery,
      submitToolbarQuery,
      clearToolbarQuery,
      searchFromCommand,
      setOption,
      setFilter,
      changeCommandInput,
      prepareCommandInput,
      previousResult,
      nextResult,
      reset,
    }),
    [
      changeCommandInput,
      changeToolbarQuery,
      clearToolbarQuery,
      nextResult,
      prepareCommandInput,
      previousResult,
      reset,
      searchFromCommand,
      setFilter,
      setOption,
      submitToolbarQuery,
    ],
  );

  return {
    snapshot: {
      toolbarQuery: state.toolbarQuery,
      searchQuery,
      searchRegex: state.searchRegex,
      searchCaseSensitive: state.searchCaseSensitive,
      searchJq: state.searchJq,
      recordFilter: state.recordFilter,
      commandInput: state.commandInput,
      pathError,
      pathMatches,
      currentPathMatchIndex,
      currentMatchIndex,
      activeSearchMatch,
      mode,
      searchStatus: revisionsAligned ? searchWorker.status : searchQuery ? "pending" : "idle",
      searchErrorKind: revisionsAligned ? searchWorker.errorKind : null,
      ...pipeline,
    },
    intent,
  };
};
