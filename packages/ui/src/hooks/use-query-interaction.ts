import type { ParseResult } from "@unquote/core";
import { useCallback, useEffect, useMemo } from "react";
import {
  createInitialQueryInteractionState,
  queryForModeState,
  reduceQueryInteraction,
} from "../lib/query-interaction";
import type {
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
import { parseTreePath } from "../lib/path-codec";
import { createSearchResultVisibility, projectSearchResult } from "../lib/search-result";
import { useRecordPipeline } from "./use-record-pipeline";
import { useSearchWorker } from "./use-search-worker";
import { useSourceRevisionState } from "./use-source-revision-state";

export const memorySearchDebounceMs = 120;
export const localFileSearchDebounceMs = 250;

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

interface QueryInteractionModel {
  state: QueryInteractionState;
  navigationIntent: QueryNavigationIntent;
  searchExpansionRevision: number;
}

type NavigationRequest = QueryNavigationMode | "from-state" | null;

const createInitialQueryInteractionModel = (): QueryInteractionModel => ({
  state: createInitialQueryInteractionState(),
  navigationIntent: { requestId: 0, mode: "none" },
  searchExpansionRevision: 0,
});

const navigationModeForState = (state: QueryInteractionState): QueryNavigationMode =>
  state.modeState.mode === "idle" ? "clear" : state.modeState.mode;

const hasSameSearchExpansion = (current: QueryInteractionState, next: QueryInteractionState) => {
  if (next.modeState.mode !== "search") {
    return true;
  }
  if (current.modeState.mode !== "search") {
    return false;
  }

  return (
    current.modeState.query === next.modeState.query &&
    current.modeState.currentMatchIndex === next.modeState.currentMatchIndex &&
    current.searchSyntax === next.searchSyntax &&
    current.searchCaseSensitive === next.searchCaseSensitive &&
    current.recordFilter === next.recordFilter
  );
};

const reconcileCurrentMatch = (state: QueryInteractionState, currentMatchIndex: number) =>
  state.modeState.mode !== "search" || currentMatchIndex === state.modeState.currentMatchIndex
    ? state
    : {
        ...state,
        modeState: { ...state.modeState, currentMatchIndex },
      };

export const useQueryInteraction = ({
  source,
  resultRevision,
  result,
  translateError,
  recordAppend = null,
}: UseQueryInteractionOptions) => {
  const sourceRevision = source.sourceRevision;
  const [model, updateModel] = useSourceRevisionState(
    sourceRevision,
    createInitialQueryInteractionModel,
  );
  const { state, navigationIntent, searchExpansionRevision } = model;
  const mode = state.modeState.mode;
  const searchQuery = mode === "search" ? state.modeState.query : "";
  const pathQuery = mode === "path" && state.modeState.submitted ? state.modeState.query : "";
  const pathSegments = useMemo(() => (pathQuery ? parseTreePath(pathQuery) : null), [pathQuery]);
  const workerQuery = mode === "path" ? (pathSegments ? pathQuery : "") : searchQuery;
  const searchOptions = useMemo<SearchOptions>(
    () => ({
      syntax: mode === "path" ? "path" : state.searchSyntax,
      caseSensitive: mode === "path" || state.searchCaseSensitive,
    }),
    [mode, state.searchCaseSensitive, state.searchSyntax],
  );
  const searchWorker = useSearchWorker({
    source,
    query: workerQuery,
    options: searchOptions,
    debounceMs:
      mode === "path"
        ? 0
        : source.kind === "local-file"
          ? localFileSearchDebounceMs
          : memorySearchDebounceMs,
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
    searchResult: revisionsAligned && mode === "search" ? searchWorker.result : null,
    currentMatchIndex: requestedCurrentMatchIndex,
    recordFilter: state.recordFilter,
    recordAppend,
  });

  const pathResult = revisionsAligned && mode === "path" ? searchWorker.result : null;
  const pathVisibility = useMemo(
    () => createSearchResultVisibility(pathResult, pipeline.visibleRecords),
    [pathResult, pipeline.visibleRecords],
  );
  const requestedPathIndex = mode === "path" ? state.modeState.currentIndex : 0;
  const pathProjection = useMemo(
    () => projectSearchResult(pathResult, pathVisibility, requestedPathIndex),
    [pathResult, pathVisibility, requestedPathIndex],
  );
  const pathError =
    pathQuery && !pathSegments
      ? translateError("invalid")
      : pathResult && pathResult.total === 0
        ? translateError("not-found")
        : null;
  const currentPathMatchIndex = pathProjection.currentMatchIndex;
  const pathMatchCount = pathProjection.matchCount;
  const activePathMatch = pathProjection.activeMatch;

  const currentMatchIndex = pipeline.currentMatchIndex;
  const activeSearchMatch = mode === "search" ? pipeline.activeSearchMatch : null;
  const activeSearchRecordId = activeSearchMatch?.recordId ?? null;
  const activeSearchPathText = activeSearchMatch?.pathText ?? null;

  const activeMatch = mode === "path" ? activePathMatch : activeSearchMatch;
  const activeMatchCount = mode === "path" ? pathMatchCount : pipeline.matchCount;
  const requestedWindowIndexes =
    mode === "path" ? pathProjection.requestedWindowIndexes : pipeline.requestedSearchWindowIndexes;
  useEffect(() => {
    if (!revisionsAligned || activeMatchCount === 0 || activeMatch) {
      return;
    }
    searchWorker.requestWindow(requestedWindowIndexes);
  }, [
    activeMatch,
    activeMatchCount,
    requestedWindowIndexes,
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

    return {
      requestId: navigationIntent.requestId,
      target:
        activePathMatch && pathSegments
          ? {
              sourceRevision,
              kind: "path",
              target: {
                recordId: activePathMatch.recordId,
                pathText: activePathMatch.pathText,
                rawKey: pathSegments.at(-1)?.value ?? "$",
                stringifiedPathChain: activePathMatch.stringifiedPathChain,
              },
            }
          : { sourceRevision, kind: "clear" },
    };
  }, [
    activePathMatch,
    navigationIntent.mode,
    navigationIntent.requestId,
    pathSegments,
    sourceRevision,
  ]);
  const navigation =
    navigationIntent.mode === "clear"
      ? clearNavigation
      : navigationIntent.mode === "search"
        ? searchNavigation
        : navigationIntent.mode === "path"
          ? pathNavigation
          : null;

  const transition = useCallback(
    (action: QueryInteractionAction, navigationRequest: NavigationRequest) => {
      updateModel((current) => {
        const transitionState =
          navigationRequest === "from-state"
            ? reconcileCurrentMatch(current.state, currentMatchIndex)
            : current.state;
        const nextState = reduceQueryInteraction(transitionState, action);
        const nextNavigationIntent =
          navigationRequest === null
            ? current.navigationIntent
            : {
                requestId: current.navigationIntent.requestId + 1,
                mode:
                  navigationRequest === "from-state"
                    ? navigationModeForState(nextState)
                    : navigationRequest,
              };
        const nextSearchExpansionRevision = hasSameSearchExpansion(transitionState, nextState)
          ? current.searchExpansionRevision
          : current.searchExpansionRevision + 1;

        if (
          nextState === current.state &&
          nextNavigationIntent === current.navigationIntent &&
          nextSearchExpansionRevision === current.searchExpansionRevision
        ) {
          return current;
        }

        return {
          state: nextState,
          navigationIntent: nextNavigationIntent,
          searchExpansionRevision: nextSearchExpansionRevision,
        };
      });
    },
    [currentMatchIndex, updateModel],
  );

  const navigate = useCallback(
    (action: QueryInteractionAction) => transition(action, "from-state"),
    [transition],
  );

  const changeToolbarQuery = useCallback(
    (value: string) => navigate({ type: "toolbarQueryChange", value }),
    [navigate],
  );
  const submitToolbarQuery = useCallback(
    (value: string) => navigate({ type: "submitToolbarQuery", value }),
    [navigate],
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
    (filter: QueryInteractionState["recordFilter"]) =>
      transition({ type: "setRecordFilter", filter }, "clear"),
    [transition],
  );
  const revealAllRecords = useCallback(
    () => transition({ type: "setRecordFilter", filter: "all" }, "none"),
    [transition],
  );
  const changeCommandInput = useCallback(
    (value: string) => transition({ type: "setCommandInput", value }, null),
    [transition],
  );
  const prepareCommandInput = useCallback(
    () => transition({ type: "seedCommandInput" }, null),
    [transition],
  );
  const previousResult = useCallback(() => {
    return mode === "path"
      ? navigate({ type: "prevPathMatch", matchCount: pathMatchCount })
      : navigate({ type: "prevMatch", matchCount: pipeline.matchCount });
  }, [mode, navigate, pathMatchCount, pipeline.matchCount]);
  const nextResult = useCallback(() => {
    return mode === "path"
      ? navigate({ type: "nextPathMatch", matchCount: pathMatchCount })
      : navigate({ type: "nextMatch", matchCount: pipeline.matchCount });
  }, [mode, navigate, pathMatchCount, pipeline.matchCount]);
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
    searchExpansionRevision,
    snapshot: {
      toolbarQuery: queryForModeState(state.modeState),
      searchQuery,
      searchRegex: state.searchSyntax === "regex",
      searchCaseSensitive: state.searchCaseSensitive,
      searchJq: state.searchSyntax === "jq",
      recordFilter: state.recordFilter,
      commandInput: state.commandInput,
      pathError,
      pathMatchCount,
      currentPathMatchIndex,
      mode,
      searchStatus: revisionsAligned ? searchWorker.status : workerQuery ? "pending" : "idle",
      searchErrorKind: revisionsAligned ? searchWorker.errorKind : null,
      ...pipeline,
    },
    intent,
  };
};
