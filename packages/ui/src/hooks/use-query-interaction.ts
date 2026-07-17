import type { JsonlRecord, ParseResult } from "@unquote/core";
import { useCallback, useEffect, useMemo, useReducer } from "react";
import {
  createInitialQueryInteractionState,
  isPathLikeQuery,
  reduceQueryInteraction,
  resolveQueryMode,
} from "../lib/query-interaction";
import type {
  PathResolution,
  QueryInteractionAction,
  QueryInteractionState,
  SearchOptionKind,
} from "../lib/query-interaction";
import { fileSearchDebounceMs } from "../lib/local-file-source";
import { resolveTreePathMatches } from "../lib/tree";
import type { ResolvedTreePath, SearchOptions } from "../lib/tree";
import { useRecordPipeline } from "./use-record-pipeline";
import { useSearchWorker } from "./use-search-worker";

export const memorySearchDebounceMs = 120;

export type QueryNavigationTarget =
  | { kind: "clear" }
  | { kind: "path"; target: ResolvedTreePath }
  | { kind: "search"; recordId: string; pathText: string };

interface UseQueryInteractionOptions {
  result: ParseResult;
  sourceText: string;
  sourceFile: File | null;
  forcedFormat: "json" | "jsonl" | undefined;
  translateError: (reason: "invalid" | "not-found") => string;
  onNavigate: (target: QueryNavigationTarget) => void;
}

export const useQueryInteraction = ({
  result,
  sourceText,
  sourceFile,
  forcedFormat,
  translateError,
  onNavigate,
}: UseQueryInteractionOptions) => {
  const [state, dispatch] = useReducer(
    reduceQueryInteraction,
    undefined,
    createInitialQueryInteractionState,
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

  const mode = useMemo(() => resolveQueryMode(state.toolbarQuery), [state.toolbarQuery]);
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
    sourceFile,
    query: state.searchQuery,
    options: searchOptions,
    debounceMs: sourceFile ? fileSearchDebounceMs : memorySearchDebounceMs,
    ...(forcedFormat ? { forcedFormat } : {}),
  });
  const pipeline = useRecordPipeline({
    result,
    searchMatches: searchWorker.matches,
    recordFilter: state.recordFilter,
  });

  useEffect(() => {
    dispatch({ type: "clampMatchIndex", matchCount: pipeline.matchCount });
  }, [pipeline.matchCount]);

  const resetKey = `${state.recordFilter}|${state.searchRegex}|${state.searchCaseSensitive}|${state.searchJq}|${state.searchQuery}`;
  useEffect(() => {
    dispatch({ type: "resetMatchIndex" });
  }, [resetKey]);

  useEffect(() => {
    dispatch({ type: "resetPathForFilter" });
  }, [state.recordFilter]);

  const activeSearchMatch =
    mode === "search"
      ? (pipeline.visibleMatches?.[state.currentMatchIndex] ?? pipeline.visibleMatches?.[0] ?? null)
      : null;
  const activeSearchRecordId = activeSearchMatch?.recordId ?? null;
  const activeSearchPathText = activeSearchMatch?.pathText ?? null;

  useEffect(() => {
    if (!activeSearchRecordId || !activeSearchPathText) {
      return;
    }

    onNavigate({
      kind: "search",
      recordId: activeSearchRecordId,
      pathText: activeSearchPathText,
    });
  }, [activeSearchPathText, activeSearchRecordId, onNavigate, state.currentMatchIndex]);

  const invalidateNavigation = useCallback(() => onNavigate({ kind: "clear" }), [onNavigate]);

  const navigate = useCallback(
    (action: QueryInteractionAction) => {
      const nextState = reduceQueryInteraction(state, action);
      dispatch(action);

      if (resolveQueryMode(nextState.toolbarQuery) === "path") {
        const target =
          nextState.pathMatches[nextState.currentPathMatchIndex] ?? nextState.pathMatches[0];
        if (target) {
          onNavigate({ kind: "path", target });
        }
        return;
      }

      if (
        nextState.currentMatchIndex === state.currentMatchIndex &&
        activeSearchRecordId &&
        activeSearchPathText
      ) {
        onNavigate({
          kind: "search",
          recordId: activeSearchRecordId,
          pathText: activeSearchPathText,
        });
      }
    },
    [activeSearchPathText, activeSearchRecordId, onNavigate, state],
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
  const selectOverviewPath = useCallback(
    (value: string) => {
      invalidateNavigation();
      const resolution = resolvePathQuery(result.records, value);
      navigate({
        type: "overviewPathSelect",
        value,
        resolution,
      });
    },
    [invalidateNavigation, navigate, resolvePathQuery, result.records],
  );
  const searchOverviewFieldValue = useCallback(
    (value: string) => {
      invalidateNavigation();
      dispatch({ type: "overviewFieldValueSearch", value });
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
    [],
  );
  const prepareCommandInput = useCallback(() => dispatch({ type: "seedCommandInput" }), []);
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
  const reset = useCallback(() => dispatch({ type: "resetAll" }), []);

  const intent = useMemo(
    () => ({
      changeToolbarQuery,
      submitToolbarQuery,
      clearToolbarQuery,
      searchFromCommand,
      selectOverviewPath,
      searchOverviewFieldValue,
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
      searchOverviewFieldValue,
      selectOverviewPath,
      setFilter,
      setOption,
      submitToolbarQuery,
    ],
  );

  return {
    snapshot: {
      toolbarQuery: state.toolbarQuery,
      searchQuery: state.searchQuery,
      searchRegex: state.searchRegex,
      searchCaseSensitive: state.searchCaseSensitive,
      searchJq: state.searchJq,
      recordFilter: state.recordFilter,
      commandInput: state.commandInput,
      pathError: state.pathError,
      pathMatches: state.pathMatches,
      currentPathMatchIndex: state.currentPathMatchIndex,
      currentMatchIndex: state.currentMatchIndex,
      mode,
      searchStatus: searchWorker.status,
      searchErrorKind: searchWorker.errorKind,
      ...pipeline,
    },
    intent,
  };
};
