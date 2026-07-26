import type { RecordFilterMode } from "./record-filter";
import type { TreePathMatch } from "./tree-path";

export type QueryModeState =
  | { mode: "idle" }
  | { mode: "search"; query: string; currentMatchIndex: number }
  | {
      mode: "path";
      query: string;
      error: string | null;
      matches: TreePathMatch[];
      currentIndex: number;
    };

export type QueryMode = QueryModeState["mode"];

export interface QueryInteractionState {
  toolbarQuery: string;
  modeState: QueryModeState;
  searchRegex: boolean;
  searchCaseSensitive: boolean;
  searchJq: boolean;
  recordFilter: RecordFilterMode;
  commandInput: string;
}

export const isPathLikeQuery = (value: string) =>
  /^\s*[$.[\]]/.test(value) || value.trimStart().startsWith(".");

export const createInitialQueryInteractionState = (): QueryInteractionState => ({
  toolbarQuery: "",
  modeState: { mode: "idle" },
  searchRegex: false,
  searchCaseSensitive: false,
  searchJq: false,
  recordFilter: "all",
  commandInput: "",
});

export type SearchOptionKind = "regex" | "caseSensitive" | "jq";

// Path resolution needs the current record set, which only the caller has at
// dispatch time — so it happens in the hook callback and the reducer receives
// the outcome, staying a pure state transition.
export type PathResolution =
  | { query: string; ok: true; targets: TreePathMatch[] }
  | { query: string; ok: false; error: string };

export type QueryInteractionAction =
  | { type: "toolbarQueryChange"; value: string }
  | { type: "submitToolbarQuery"; value: string; resolution: PathResolution | null }
  | { type: "clearToolbarQuery" }
  | { type: "commandSearch"; value: string }
  | { type: "overviewPathSelect"; value: string; resolution: PathResolution | null }
  | { type: "overviewFieldValueSearch"; value: string }
  | { type: "setSearchOption"; kind: SearchOptionKind; on: boolean }
  | { type: "setRecordFilter"; filter: QueryInteractionState["recordFilter"] }
  | { type: "setCommandInput"; value: string }
  | { type: "seedCommandInput" }
  | { type: "prevMatch"; matchCount: number }
  | { type: "nextMatch"; matchCount: number }
  | { type: "prevPathMatch" }
  | { type: "nextPathMatch" }
  | { type: "resetAll" };

export const reconcileMatchIndex = (currentMatchIndex: number, matchCount: number) =>
  matchCount === 0 ? 0 : Math.min(currentMatchIndex, matchCount - 1);

export const reduceQueryInteraction = (
  state: QueryInteractionState,
  action: QueryInteractionAction,
): QueryInteractionState => {
  switch (action.type) {
    case "toolbarQueryChange": {
      return {
        ...state,
        toolbarQuery: action.value,
        modeState: createModeState(action.value),
      };
    }

    case "submitToolbarQuery": {
      if (!action.resolution) {
        const modeState =
          state.modeState.mode === "search" && state.modeState.query === action.value
            ? state.modeState
            : createModeState(action.value);
        return { ...state, toolbarQuery: action.value, modeState };
      }

      return applyPathResolution(state, action.value, action.resolution);
    }

    case "overviewPathSelect": {
      if (!action.resolution) {
        return {
          ...state,
          toolbarQuery: action.value,
          modeState: createModeState(action.value),
          recordFilter: "all",
        };
      }

      return applyPathResolution(
        { ...state, recordFilter: "all" },
        action.value,
        action.resolution,
      );
    }

    case "clearToolbarQuery": {
      return {
        ...state,
        toolbarQuery: "",
        modeState: { mode: "idle" },
      };
    }

    case "commandSearch": {
      return {
        ...state,
        toolbarQuery: action.value,
        modeState: createSearchModeState(action.value),
        recordFilter: "matches",
      };
    }

    case "overviewFieldValueSearch": {
      return {
        ...state,
        toolbarQuery: action.value,
        modeState: createSearchModeState(action.value),
        searchRegex: false,
        searchCaseSensitive: false,
        searchJq: false,
        recordFilter: "matches",
      };
    }

    case "setSearchOption": {
      const modeState = resetSearchMatchIndex(state.modeState);
      if (action.kind === "jq" && action.on) {
        return { ...state, modeState, searchJq: true, searchRegex: false };
      }
      if (action.kind === "regex" && action.on) {
        return { ...state, modeState, searchRegex: true, searchJq: false };
      }
      if (action.kind === "jq") {
        return { ...state, modeState, searchJq: action.on };
      }
      if (action.kind === "regex") {
        return { ...state, modeState, searchRegex: action.on };
      }
      return { ...state, modeState, searchCaseSensitive: action.on };
    }

    case "setRecordFilter": {
      if (state.recordFilter === action.filter) {
        return state;
      }

      return {
        ...state,
        recordFilter: action.filter,
        modeState: resetModeNavigation(state.modeState),
      };
    }

    case "setCommandInput": {
      return { ...state, commandInput: action.value };
    }

    case "seedCommandInput": {
      return {
        ...state,
        commandInput:
          state.toolbarQuery || (state.modeState.mode === "idle" ? "" : state.modeState.query),
      };
    }

    case "prevMatch": {
      const matchCount = action.matchCount;
      if (state.modeState.mode !== "search" || matchCount === 0) {
        return state;
      }
      const currentMatchIndex = reconcileMatchIndex(state.modeState.currentMatchIndex, matchCount);
      return {
        ...state,
        modeState: {
          ...state.modeState,
          currentMatchIndex: (currentMatchIndex - 1 + matchCount) % matchCount,
        },
      };
    }

    case "nextMatch": {
      const matchCount = action.matchCount;
      if (state.modeState.mode !== "search" || matchCount === 0) {
        return state;
      }
      const currentMatchIndex = reconcileMatchIndex(state.modeState.currentMatchIndex, matchCount);
      return {
        ...state,
        modeState: {
          ...state.modeState,
          currentMatchIndex: (currentMatchIndex + 1) % matchCount,
        },
      };
    }

    case "prevPathMatch": {
      if (state.modeState.mode !== "path" || state.modeState.matches.length === 0) {
        return state;
      }
      const next =
        (state.modeState.currentIndex - 1 + state.modeState.matches.length) %
        state.modeState.matches.length;
      return { ...state, modeState: { ...state.modeState, currentIndex: next } };
    }

    case "nextPathMatch": {
      if (state.modeState.mode !== "path" || state.modeState.matches.length === 0) {
        return state;
      }
      const next = (state.modeState.currentIndex + 1) % state.modeState.matches.length;
      return { ...state, modeState: { ...state.modeState, currentIndex: next } };
    }

    case "resetAll": {
      return createInitialQueryInteractionState();
    }
  }

  action satisfies never;
  return state;
};

const createSearchModeState = (query: string): QueryModeState =>
  query.trim() ? { mode: "search", query, currentMatchIndex: 0 } : { mode: "idle" };

const createModeState = (query: string): QueryModeState => {
  if (!query.trim()) {
    return { mode: "idle" };
  }

  return isPathLikeQuery(query)
    ? { mode: "path", query, error: null, matches: [], currentIndex: 0 }
    : createSearchModeState(query);
};

const resetSearchMatchIndex = (modeState: QueryModeState): QueryModeState =>
  modeState.mode === "search" ? { ...modeState, currentMatchIndex: 0 } : modeState;

const resetModeNavigation = (modeState: QueryModeState): QueryModeState => {
  switch (modeState.mode) {
    case "idle":
      return modeState;
    case "search":
      return { ...modeState, currentMatchIndex: 0 };
    case "path":
      return { ...modeState, error: null, matches: [], currentIndex: 0 };
  }
};

const applyPathResolution = (
  state: QueryInteractionState,
  toolbarValue: string,
  resolution: PathResolution,
): QueryInteractionState => ({
  ...state,
  toolbarQuery: toolbarValue,
  modeState: {
    mode: "path",
    query: resolution.query,
    error: resolution.ok ? null : resolution.error,
    matches: resolution.ok ? resolution.targets : [],
    currentIndex: 0,
  },
});
