import type { JsonlRecord } from "@unquote/core";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import {
  createInitialQueryInteractionState,
  reduceQueryInteraction,
} from "../lib/query-interaction";
import type {
  QueryInteractionAction,
  QueryInteractionContext,
  QueryInteractionState,
  QueryMode,
  SearchOptionKind,
} from "../lib/query-interaction";
import { resolveQueryMode } from "../lib/query-interaction";
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

export interface SearchMatchRef {
  recordId: string;
  pathText: string;
  stringifiedPathChain: string[];
}

export interface UseQueryInteractionOptions {
  allRecords: JsonlRecord[];
  translateError: (reason: "invalid" | "not-found") => string;
  // Match data flows in via mutable refs so the hook can be placed before the
  // match pipeline while still reading the latest values in callbacks/effects.
  visibleRecordsRef: { current: JsonlRecord[] };
  matchCountRef: { current: number };
  visibleMatchesRef: { current: SearchMatchRef[] | null };
}

export interface QueryInteraction {
  state: QueryInteractionState;
  mode: QueryMode;
  navigationTarget: NavigationTarget | null;
  setToolbarQuery: (value: string) => void;
  submitToolbarQuery: (value: string) => void;
  clearToolbarQuery: () => void;
  commandSearch: (value: string) => void;
  overviewPathSelect: (value: string) => void;
  overviewFieldValueSearch: (value: string) => void;
  setSearchOption: (kind: SearchOptionKind, on: boolean) => void;
  setRecordFilter: (filter: QueryInteractionState["recordFilter"]) => void;
  setCommandInput: (value: string) => void;
  seedCommandInput: () => void;
  prevMatch: () => void;
  nextMatch: () => void;
  prevPathMatch: () => void;
  nextPathMatch: () => void;
  clearPathMatches: () => void;
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

export const useQueryInteraction = (options: UseQueryInteractionOptions): QueryInteraction => {
  const { allRecords, translateError, visibleRecordsRef, matchCountRef, visibleMatchesRef } =
    options;

  const allRecordsRef = useRef(allRecords);
  allRecordsRef.current = allRecords;
  const translateErrorRef = useRef(translateError);
  translateErrorRef.current = translateError;

  const ctxRef = useRef<QueryInteractionContext>({
    get visibleRecords() {
      return visibleRecordsRef.current;
    },
    get allRecords() {
      return allRecordsRef.current;
    },
    resolvePath: (records, query) => {
      const result = resolveTreePathMatches(records as JsonlRecord[], query);
      return result.ok
        ? { ok: true, targets: result.targets }
        : { ok: false, reason: result.reason, targets: [] };
    },
    get translateError() {
      return translateErrorRef.current;
    },
  });

  const [state, dispatch] = useReducer(
    (current: QueryInteractionState, action: QueryInteractionAction) =>
      reduceQueryInteraction(current, action, ctxRef.current),
    undefined,
    createInitialQueryInteractionState,
  );

  // Bumped whenever a navigating action runs, so the app effect re-fires even
  // when the derived target value is identical to the previous one.
  const [navVersion, bumpNavVersion] = useReducer((n: number) => n + 1, 0);

  const navigate = useCallback((action: QueryInteractionAction) => {
    dispatch(action);
    if (NAVIGATING_ACTIONS.has(action.type)) {
      bumpNavVersion();
    }
  }, []);

  const setToolbarQuery = useCallback((value: string) => {
    dispatch({ type: "toolbarQueryChange", value });
  }, []);
  const submitToolbarQuery = useCallback(
    (value: string) => navigate({ type: "submitToolbarQuery", value }),
    [navigate],
  );
  const clearToolbarQuery = useCallback(() => {
    dispatch({ type: "clearToolbarQuery" });
  }, []);
  const commandSearch = useCallback((value: string) => {
    dispatch({ type: "commandSearch", value });
  }, []);
  const overviewPathSelect = useCallback(
    (value: string) => navigate({ type: "overviewPathSelect", value }),
    [navigate],
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
    () => navigate({ type: "prevMatch", matchCount: matchCountRef.current }),
    [navigate],
  );
  const nextMatch = useCallback(
    () => navigate({ type: "nextMatch", matchCount: matchCountRef.current }),
    [navigate],
  );
  const prevPathMatch = useCallback(() => navigate({ type: "prevPathMatch" }), [navigate]);
  const nextPathMatch = useCallback(() => navigate({ type: "nextPathMatch" }), [navigate]);
  const reset = useCallback(() => {
    dispatch({ type: "resetAll" });
  }, []);
  const clearPathMatches = useCallback(() => {
    dispatch({ type: "clearPathMatches" });
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

  const matchCount = matchCountRef.current;
  // Clamp the match index to the current match count (mirrors app effect).
  useEffect(() => {
    dispatch({ type: "clampMatchIndex", matchCount });
  }, [matchCount]);

  const mode = useMemo(() => resolveQueryMode(state.toolbarQuery), [state.toolbarQuery]);

  const visibleMatches = visibleMatchesRef.current;
  const navigationTarget = useMemo<NavigationTarget | null>(() => {
    void navVersion;
    if (mode === "path" && state.pathMatches.length > 0) {
      const target = state.pathMatches[state.currentPathMatchIndex] ?? state.pathMatches[0]!;
      return {
        recordId: target.recordId,
        pathText: target.pathText,
        rawKey: target.rawKey,
        stringifiedPathChain: target.stringifiedPathChain,
        kind: "path",
        version: navVersion,
      };
    }
    if (mode === "search" && visibleMatches && visibleMatches.length > 0) {
      return { kind: "search", matchIndex: state.currentMatchIndex, version: navVersion };
    }
    return null;
  }, [
    mode,
    state.pathMatches,
    state.currentPathMatchIndex,
    state.currentMatchIndex,
    visibleMatches,
    navVersion,
  ]);

  return {
    state,
    mode,
    navigationTarget,
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
    prevPathMatch,
    nextPathMatch,
    clearPathMatches,
    reset,
  };
};
