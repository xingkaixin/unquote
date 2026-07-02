import type { JsonlRecord } from "@unquote/core";
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
  QueryMode,
  SearchOptionKind,
} from "../lib/query-interaction";
import { resolveTreePathMatches } from "../lib/tree";

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

export interface UseQueryInteractionOptions {
  allRecords: JsonlRecord[];
  translateError: (reason: "invalid" | "not-found") => string;
}

export interface QueryInteraction {
  state: QueryInteractionState;
  mode: QueryMode;
  // Bumped on every navigating action so the app effect re-fires even when the
  // derived navigation target is identical to the previous one.
  navVersion: number;
  setToolbarQuery: (value: string) => void;
  // Callbacks that need pipeline output (visible records / match count) take
  // it as an argument: the app binds the current-frame values after the
  // pipeline runs, keeping the data flow one-directional.
  submitToolbarQuery: (value: string, visibleRecords: JsonlRecord[]) => void;
  clearToolbarQuery: () => void;
  commandSearch: (value: string) => void;
  overviewPathSelect: (value: string) => void;
  overviewFieldValueSearch: (value: string) => void;
  setSearchOption: (kind: SearchOptionKind, on: boolean) => void;
  setRecordFilter: (filter: QueryInteractionState["recordFilter"]) => void;
  setCommandInput: (value: string) => void;
  seedCommandInput: () => void;
  prevMatch: (matchCount: number) => void;
  nextMatch: (matchCount: number) => void;
  clampMatchIndex: (matchCount: number) => void;
  prevPathMatch: () => void;
  nextPathMatch: () => void;
  reset: () => void;
}

// Actions that produce a navigation the app must react to (scroll + select).
const NAVIGATING_ACTIONS = new Set<QueryInteractionAction["type"]>([
  "submitToolbarQuery",
  "overviewPathSelect",
  "prevMatch",
  "nextMatch",
  "prevPathMatch",
  "nextPathMatch",
]);

// Pure derivation of the navigation target; the app memoizes it after the
// match pipeline so it reads the current frame's matches. Takes only the
// fields it consumes so the memo doesn't re-fire on unrelated state changes.
export const buildNavigationTarget = (
  state: Pick<QueryInteractionState, "pathMatches" | "currentPathMatchIndex" | "currentMatchIndex">,
  mode: QueryMode,
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

export const useQueryInteraction = (options: UseQueryInteractionOptions): QueryInteraction => {
  const { allRecords, translateError } = options;

  const [state, dispatch] = useReducer(
    reduceQueryInteraction,
    undefined,
    createInitialQueryInteractionState,
  );

  const [navVersion, bumpNavVersion] = useReducer((n: number) => n + 1, 0);

  const navigate = useCallback((action: QueryInteractionAction) => {
    dispatch(action);
    if (NAVIGATING_ACTIONS.has(action.type)) {
      bumpNavVersion();
    }
  }, []);

  // Path resolution happens here (not in the reducer) so the reducer stays a
  // pure state transition and the record types stay strong end to end.
  const resolvePathQuery = useCallback(
    (records: JsonlRecord[], value: string): PathResolution | null => {
      const query = value.trim();
      if (!query || !isPathLikeQuery(query)) {
        return null;
      }

      const result = resolveTreePathMatches(records, query);
      return result.ok
        ? { query, ok: true, targets: result.targets }
        : { query, ok: false, error: translateError(result.reason) };
    },
    [translateError],
  );

  const setToolbarQuery = useCallback((value: string) => {
    dispatch({ type: "toolbarQueryChange", value });
  }, []);
  const submitToolbarQuery = useCallback(
    (value: string, visibleRecords: JsonlRecord[]) =>
      navigate({
        type: "submitToolbarQuery",
        value,
        resolution: resolvePathQuery(visibleRecords, value),
      }),
    [navigate, resolvePathQuery],
  );
  const clearToolbarQuery = useCallback(() => {
    dispatch({ type: "clearToolbarQuery" });
  }, []);
  const commandSearch = useCallback((value: string) => {
    dispatch({ type: "commandSearch", value });
  }, []);
  const overviewPathSelect = useCallback(
    (value: string) =>
      navigate({
        type: "overviewPathSelect",
        value,
        resolution: resolvePathQuery(allRecords, value),
      }),
    [allRecords, navigate, resolvePathQuery],
  );
  const overviewFieldValueSearch = useCallback((value: string) => {
    dispatch({ type: "overviewFieldValueSearch", value });
  }, []);
  const setSearchOption = useCallback((kind: SearchOptionKind, on: boolean) => {
    dispatch({ type: "setSearchOption", kind, on });
  }, []);
  const setRecordFilter = useCallback((filter: QueryInteractionState["recordFilter"]) => {
    dispatch({ type: "setRecordFilter", filter });
  }, []);
  const setCommandInput = useCallback((value: string) => {
    dispatch({ type: "setCommandInput", value });
  }, []);
  const seedCommandInput = useCallback(() => {
    dispatch({ type: "seedCommandInput" });
  }, []);
  const prevMatch = useCallback(
    (matchCount: number) => navigate({ type: "prevMatch", matchCount }),
    [navigate],
  );
  const nextMatch = useCallback(
    (matchCount: number) => navigate({ type: "nextMatch", matchCount }),
    [navigate],
  );
  const clampMatchIndex = useCallback((matchCount: number) => {
    dispatch({ type: "clampMatchIndex", matchCount });
  }, []);
  const prevPathMatch = useCallback(() => navigate({ type: "prevPathMatch" }), [navigate]);
  const nextPathMatch = useCallback(() => navigate({ type: "nextPathMatch" }), [navigate]);
  const reset = useCallback(() => {
    dispatch({ type: "resetAll" });
  }, []);

  // Reset match index when filter or search options/query change (mirrors app effect).
  const resetKey = `${state.recordFilter}|${state.searchRegex}|${state.searchCaseSensitive}|${state.searchJq}|${state.searchQuery}`;
  useEffect(() => {
    dispatch({ type: "resetMatchIndex" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // Reset path state when the filter changes (mirrors app effect).
  useEffect(() => {
    dispatch({ type: "resetPathForFilter" });
  }, [state.recordFilter]);

  const mode = useMemo(() => resolveQueryMode(state.toolbarQuery), [state.toolbarQuery]);

  return {
    state,
    mode,
    navVersion,
    setToolbarQuery,
    submitToolbarQuery,
    clearToolbarQuery,
    commandSearch,
    overviewPathSelect,
    overviewFieldValueSearch,
    setSearchOption,
    setRecordFilter,
    setCommandInput,
    seedCommandInput,
    prevMatch,
    nextMatch,
    clampMatchIndex,
    prevPathMatch,
    nextPathMatch,
    reset,
  };
};
