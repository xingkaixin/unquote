import type { JsonlRecord, ParseResult } from "@unquote/core";
import { useCallback, useEffect, useMemo } from "react";
import {
  createInitialQueryInteractionState,
  isPathLikeQuery,
  reduceQueryInteraction,
} from "../lib/query-interaction";
import type {
  PathResolution,
  QueryInteractionAction,
  QueryInteractionState,
  SearchOptionKind,
} from "../lib/query-interaction";
import type { QueryNavigationRequest, QueryNavigationTarget } from "../lib/query-navigation";
import type { PublishedSourceRevision } from "../lib/published-source";
import type { SearchOptions } from "../lib/record-search";
import type { RecordAppend } from "../lib/record-sequence";
import { shareSourceRevision } from "../lib/source-revision";
import type { SourceRevision } from "../lib/source-revision";
import { resolveTreePath, resolveTreePathMatches } from "../lib/tree-path";
import type { TreePathMatch } from "../lib/tree-path";
import { useRecordPipeline } from "./use-record-pipeline";
import { useSearchWorker } from "./use-search-worker";
import { useSourceRevisionState } from "./use-source-revision-state";

export const memorySearchDebounceMs = 120;
export const localFileSearchDebounceMs = 250;
const emptyPathMatches: TreePathMatch[] = [];

export type { QueryNavigationTarget } from "../lib/query-navigation";

interface UseQueryInteractionOptions {
  source: PublishedSourceRevision;
  resultRevision: SourceRevision;
  result: ParseResult;
  translateError: (reason: "invalid" | "not-found") => string;
  recordAppend?: RecordAppend | null;
}

type QueryNavigationMode = QueryNavigationTarget["kind"] | "none";

interface QueryNavigationIntent {
  requestId: number;
  mode: QueryNavigationMode;
}

const createInitialNavigationIntent = (): QueryNavigationIntent => ({
  requestId: 0,
  mode: "none",
});

const navigationModeForState = (state: QueryInteractionState): QueryNavigationMode =>
  state.modeState.mode === "idle" ? "clear" : state.modeState.mode;

export const useQueryInteraction = ({
  source,
  resultRevision,
  result,
  translateError,
  recordAppend = null,
}: UseQueryInteractionOptions) => {
  const sourceRevision = source.sourceRevision;
  const [state, updateQuery] = useSourceRevisionState(
    sourceRevision,
    createInitialQueryInteractionState,
  );
  const [navigationIntent, updateNavigationIntent] = useSourceRevisionState(
    sourceRevision,
    createInitialNavigationIntent,
  );
  const dispatch = useCallback(
    (action: QueryInteractionAction) => {
      updateQuery((current) => reduceQueryInteraction(current, action));
    },
    [updateQuery],
  );
  const requestNavigation = useCallback(
    (mode: QueryNavigationMode) => {
      updateNavigationIntent((current) => ({
        requestId: current.requestId + 1,
        mode,
      }));
    },
    [updateNavigationIntent],
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
      syntax: state.searchSyntax,
      caseSensitive: state.searchCaseSensitive,
    }),
    [state.searchCaseSensitive, state.searchSyntax],
  );
  const searchWorker = useSearchWorker({
    source,
    query: searchQuery,
    options: searchOptions,
    debounceMs: source.kind === "local-file" ? localFileSearchDebounceMs : memorySearchDebounceMs,
  });
  const revisionsAligned = shareSourceRevision(
    sourceRevision,
    { sourceRevision: resultRevision },
    searchWorker,
  );
  const requestedCurrentMatchIndex = mode === "search" ? state.modeState.currentMatchIndex : 0;
  const pipeline = useRecordPipeline({
    sourceRevision,
    result,
    searchResult: revisionsAligned ? searchWorker.result : null,
    currentMatchIndex: requestedCurrentMatchIndex,
    recordFilter: state.recordFilter,
    recordAppend,
  });

  const currentMatchIndex = pipeline.currentMatchIndex;
  const activeSearchMatch = mode === "search" ? pipeline.activeSearchMatch : null;
  const activeSearchRecordId = activeSearchMatch?.recordId ?? null;
  const activeSearchPathText = activeSearchMatch?.pathText ?? null;

  useEffect(() => {
    if (
      mode !== "search" ||
      !revisionsAligned ||
      pipeline.matchCount === 0 ||
      pipeline.activeSearchMatch
    ) {
      return;
    }
    searchWorker.requestWindow(pipeline.requestedSearchWindowIndexes);
  }, [
    mode,
    pipeline.activeSearchMatch,
    pipeline.matchCount,
    pipeline.requestedSearchWindowIndexes,
    revisionsAligned,
    searchWorker.requestWindow,
  ]);

  const clearNavigation = useMemo<QueryNavigationRequest | null>(() => {
    if (navigationIntent.requestId === 0 || navigationIntent.mode !== "clear") {
      return null;
    }

    return {
      requestId: navigationIntent.requestId,
      target: { sourceRevision, kind: "clear" },
    };
  }, [navigationIntent.mode, navigationIntent.requestId, sourceRevision]);
  const searchNavigation = useMemo<QueryNavigationRequest | null>(() => {
    if (navigationIntent.requestId === 0 || navigationIntent.mode !== "search") {
      return null;
    }

    return {
      requestId: navigationIntent.requestId,
      target:
        activeSearchRecordId && activeSearchPathText
          ? {
              sourceRevision,
              kind: "search",
              recordId: activeSearchRecordId,
              pathText: activeSearchPathText,
            }
          : { sourceRevision, kind: "clear" },
    };
  }, [
    activeSearchPathText,
    activeSearchRecordId,
    navigationIntent.mode,
    navigationIntent.requestId,
    sourceRevision,
  ]);
  const pathNavigation = useMemo<QueryNavigationRequest | null>(() => {
    if (navigationIntent.requestId === 0 || navigationIntent.mode !== "path") {
      return null;
    }

    let target: QueryNavigationTarget = { sourceRevision, kind: "clear" };
    if (state.modeState.mode === "path") {
      const match =
        state.modeState.matches[state.modeState.currentIndex] ?? state.modeState.matches[0];
      const record = match ? pipeline.recordsById.get(match.recordId) : undefined;
      const resolved = match && record ? resolveTreePath([record], match.pathText) : null;
      if (resolved?.ok) {
        target = { sourceRevision, kind: "path", target: resolved.target };
      }
    }

    return { requestId: navigationIntent.requestId, target };
  }, [
    navigationIntent.mode,
    navigationIntent.requestId,
    pipeline.recordsById,
    sourceRevision,
    state.modeState,
  ]);
  const navigation =
    navigationIntent.mode === "clear"
      ? clearNavigation
      : navigationIntent.mode === "search"
        ? searchNavigation
        : navigationIntent.mode === "path"
          ? pathNavigation
          : null;

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
      requestNavigation(navigationModeForState(nextState));
    },
    [currentMatchIndex, dispatch, requestNavigation, state],
  );

  const changeToolbarQuery = useCallback(
    (value: string) => navigate({ type: "toolbarQueryChange", value }),
    [navigate],
  );
  const submitToolbarQuery = useCallback(
    (value: string) => {
      const resolution = resolvePathQuery(pipeline.visibleRecords, value);
      navigate({
        type: "submitToolbarQuery",
        value,
        resolution,
      });
    },
    [navigate, pipeline.visibleRecords, resolvePathQuery],
  );
  const clearToolbarQuery = useCallback(() => navigate({ type: "clearToolbarQuery" }), [navigate]);
  const searchFromCommand = useCallback(
    (value: string) => navigate({ type: "commandSearch", value }),
    [navigate],
  );
  const setOption = useCallback(
    (kind: SearchOptionKind, on: boolean) => navigate({ type: "setSearchOption", kind, on }),
    [navigate],
  );
  const setFilter = useCallback(
    (filter: QueryInteractionState["recordFilter"]) => {
      dispatch({ type: "setRecordFilter", filter });
      requestNavigation("clear");
    },
    [dispatch, requestNavigation],
  );
  const revealAllRecords = useCallback(() => {
    dispatch({ type: "setRecordFilter", filter: "all" });
    requestNavigation("none");
  }, [dispatch, requestNavigation]);
  const changeCommandInput = useCallback(
    (value: string) => dispatch({ type: "setCommandInput", value }),
    [dispatch],
  );
  const prepareCommandInput = useCallback(() => dispatch({ type: "seedCommandInput" }), [dispatch]);
  const previousResult = useCallback(() => {
    return mode === "path"
      ? navigate({ type: "prevPathMatch" })
      : navigate({ type: "prevMatch", matchCount: pipeline.matchCount });
  }, [mode, navigate, pipeline.matchCount]);
  const nextResult = useCallback(() => {
    return mode === "path"
      ? navigate({ type: "nextPathMatch" })
      : navigate({ type: "nextMatch", matchCount: pipeline.matchCount });
  }, [mode, navigate, pipeline.matchCount]);
  const reset = useCallback(() => navigate({ type: "resetAll" }), [navigate]);

  const intent = useMemo(
    () => ({
      changeToolbarQuery,
      submitToolbarQuery,
      clearToolbarQuery,
      searchFromCommand,
      setOption,
      setFilter,
      revealAllRecords,
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
      revealAllRecords,
      setFilter,
      setOption,
      submitToolbarQuery,
    ],
  );

  return {
    navigation,
    searchExpansionRevision: navigationIntent.requestId,
    snapshot: {
      toolbarQuery: state.toolbarQuery,
      searchQuery,
      searchRegex: state.searchSyntax === "regex",
      searchCaseSensitive: state.searchCaseSensitive,
      searchJq: state.searchSyntax === "jq",
      recordFilter: state.recordFilter,
      commandInput: state.commandInput,
      pathError,
      pathMatches,
      currentPathMatchIndex,
      mode,
      searchStatus: revisionsAligned ? searchWorker.status : searchQuery ? "pending" : "idle",
      searchErrorKind: revisionsAligned ? searchWorker.errorKind : null,
      ...pipeline,
    },
    intent,
  };
};
