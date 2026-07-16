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
import type { SearchOptions } from "../lib/tree";
import { useRecordPipeline } from "./use-record-pipeline";
import { useSearchWorker } from "./use-search-worker";

export const memorySearchDebounceMs = 120;

export interface PathNavigationTarget {
  recordId: string;
  pathText: string;
  rawKey: string;
  stringifiedPathChain: string[];
  kind: "path";
  version: number;
}

export interface MatchNavigationTarget {
  kind: "search";
  matchIndex: number;
  version: number;
}

export type NavigationTarget = PathNavigationTarget | MatchNavigationTarget;

interface UseQueryInteractionOptions {
  result: ParseResult;
  recordsVersion: number;
  sourceText: string;
  sourceFile: File | null;
  forcedFormat: "json" | "jsonl" | undefined;
  translateError: (reason: "invalid" | "not-found") => string;
}

const NAVIGATING_ACTIONS = new Set<QueryInteractionAction["type"]>([
  "submitToolbarQuery",
  "overviewPathSelect",
  "prevMatch",
  "nextMatch",
  "prevPathMatch",
  "nextPathMatch",
]);

const buildNavigationTarget = (
  state: Pick<QueryInteractionState, "pathMatches" | "currentPathMatchIndex" | "currentMatchIndex">,
  mode: "path" | "search",
  hasVisibleMatches: boolean,
  version: number,
): NavigationTarget | null => {
  if (mode === "path" && state.pathMatches.length > 0) {
    const target = state.pathMatches[state.currentPathMatchIndex] ?? state.pathMatches[0]!;
    return {
      recordId: target.recordId,
      pathText: target.pathText,
      rawKey: target.rawKey,
      stringifiedPathChain: target.stringifiedPathChain,
      kind: "path",
      version,
    };
  }
  if (mode === "search" && hasVisibleMatches) {
    return { kind: "search", matchIndex: state.currentMatchIndex, version };
  }
  return null;
};

export const useQueryInteraction = ({
  result,
  recordsVersion,
  sourceText,
  sourceFile,
  forcedFormat,
  translateError,
}: UseQueryInteractionOptions) => {
  const [state, dispatch] = useReducer(
    reduceQueryInteraction,
    undefined,
    createInitialQueryInteractionState,
  );
  const [navigationVersion, bumpNavigationVersion] = useReducer((value: number) => value + 1, 0);

  const navigate = useCallback((action: QueryInteractionAction) => {
    dispatch(action);
    if (NAVIGATING_ACTIONS.has(action.type)) {
      bumpNavigationVersion();
    }
  }, []);

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
    recordsVersion,
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

  const navigationTarget = useMemo(
    () =>
      buildNavigationTarget(
        {
          pathMatches: state.pathMatches,
          currentPathMatchIndex: state.currentPathMatchIndex,
          currentMatchIndex: state.currentMatchIndex,
        },
        mode,
        pipeline.matchCount > 0,
        navigationVersion,
      ),
    [
      mode,
      navigationVersion,
      pipeline.matchCount,
      state.currentMatchIndex,
      state.currentPathMatchIndex,
      state.pathMatches,
    ],
  );

  const changeToolbarQuery = useCallback(
    (value: string) => dispatch({ type: "toolbarQueryChange", value }),
    [],
  );
  const submitToolbarQuery = useCallback(
    (value: string) =>
      navigate({
        type: "submitToolbarQuery",
        value,
        resolution: resolvePathQuery(pipeline.visibleRecords, value),
      }),
    [navigate, pipeline.visibleRecords, resolvePathQuery],
  );
  const clearToolbarQuery = useCallback(() => dispatch({ type: "clearToolbarQuery" }), []);
  const searchFromCommand = useCallback(
    (value: string) => dispatch({ type: "commandSearch", value }),
    [],
  );
  const selectOverviewPath = useCallback(
    (value: string) =>
      navigate({
        type: "overviewPathSelect",
        value,
        resolution: resolvePathQuery(result.records, value),
      }),
    [navigate, resolvePathQuery, result.records],
  );
  const searchOverviewFieldValue = useCallback(
    (value: string) => dispatch({ type: "overviewFieldValueSearch", value }),
    [],
  );
  const setOption = useCallback(
    (kind: SearchOptionKind, on: boolean) => dispatch({ type: "setSearchOption", kind, on }),
    [],
  );
  const setFilter = useCallback(
    (filter: QueryInteractionState["recordFilter"]) =>
      dispatch({ type: "setRecordFilter", filter }),
    [],
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
      navigationTarget,
      searchStatus: searchWorker.status,
      searchErrorKind: searchWorker.errorKind,
      ...pipeline,
    },
    intent,
  };
};
