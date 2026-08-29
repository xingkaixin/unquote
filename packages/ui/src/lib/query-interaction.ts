import type { RecordFilterMode } from "./record-filter";
import type { SearchSyntax } from "./record-search";

export type QueryModeState =
  | { mode: "idle" }
  | { mode: "search"; query: string; currentMatchIndex: number }
  | {
      mode: "path";
      query: string;
      submitted: boolean;
      currentIndex: number;
    };

export type QueryMode = QueryModeState["mode"];

export interface QueryInteractionState {
  modeState: QueryModeState;
  searchSyntax: SearchSyntax;
  searchCaseSensitive: boolean;
  recordFilter: RecordFilterMode;
  commandInput: string;
}

export const isPathLikeQuery = (value: string) =>
  /^\s*[$.[\]]/.test(value) || value.trimStart().startsWith(".");

export const createInitialQueryInteractionState = (): QueryInteractionState => ({
  modeState: { mode: "idle" },
  searchSyntax: "text",
  searchCaseSensitive: false,
  recordFilter: "all",
  commandInput: "",
});

export type SearchOptionKind = "regex" | "caseSensitive" | "jq";

export type QueryInteractionAction =
  | { type: "toolbarQueryChange"; value: string }
  | { type: "submitToolbarQuery"; value: string }
  | { type: "clearToolbarQuery" }
  | { type: "commandSearch"; value: string }
  | { type: "setSearchOption"; kind: SearchOptionKind; on: boolean }
  | { type: "setRecordFilter"; filter: QueryInteractionState["recordFilter"] }
  | { type: "setCommandInput"; value: string }
  | { type: "seedCommandInput" }
  | { type: "prevMatch"; matchCount: number }
  | { type: "nextMatch"; matchCount: number }
  | { type: "prevPathMatch"; matchCount: number }
  | { type: "nextPathMatch"; matchCount: number }
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
        modeState: createModeState(action.value),
      };
    }

    case "submitToolbarQuery": {
      const modeState =
        state.modeState.mode === "search" && state.modeState.query === action.value
          ? state.modeState
          : createModeState(action.value);
      return {
        ...state,
        modeState: modeState.mode === "path" ? { ...modeState, submitted: true } : modeState,
      };
    }

    case "clearToolbarQuery": {
      return {
        ...state,
        modeState: { mode: "idle" },
      };
    }

    case "commandSearch": {
      return {
        ...state,
        modeState: createSearchModeState(action.value),
        recordFilter: "matches",
      };
    }

    case "setSearchOption": {
      const modeState = resetSearchMatchIndex(state.modeState);
      if (action.kind === "caseSensitive") {
        return { ...state, modeState, searchCaseSensitive: action.on };
      }
      const searchSyntax = action.on
        ? action.kind
        : state.searchSyntax === action.kind
          ? "text"
          : state.searchSyntax;
      return { ...state, modeState, searchSyntax };
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
        commandInput: queryForModeState(state.modeState),
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

    case "prevPathMatch":
    case "nextPathMatch": {
      const matchCount = action.matchCount;
      if (state.modeState.mode !== "path" || matchCount === 0) {
        return state;
      }
      const currentIndex = reconcileMatchIndex(state.modeState.currentIndex, matchCount);
      const direction = action.type === "prevPathMatch" ? -1 : 1;
      return {
        ...state,
        modeState: {
          ...state.modeState,
          currentIndex: (currentIndex + direction + matchCount) % matchCount,
        },
      };
    }

    case "resetAll": {
      return createInitialQueryInteractionState();
    }
  }

  action satisfies never;
  return state;
};

export const queryForModeState = (modeState: QueryModeState) =>
  modeState.mode === "idle" ? "" : modeState.query;

const createSearchModeState = (query: string): QueryModeState =>
  query.trim() ? { mode: "search", query, currentMatchIndex: 0 } : { mode: "idle" };

const createModeState = (query: string): QueryModeState => {
  if (!query.trim()) {
    return { mode: "idle" };
  }

  return isPathLikeQuery(query)
    ? { mode: "path", query, submitted: false, currentIndex: 0 }
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
      return { ...modeState, submitted: false, currentIndex: 0 };
  }
};
