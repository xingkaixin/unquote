import type { ResolvedTreePath } from "./tree";

export type QueryMode = "search" | "path";

export interface QueryInteractionState {
  toolbarQuery: string;
  searchQuery: string;
  searchRegex: boolean;
  searchCaseSensitive: boolean;
  searchJq: boolean;
  pathQuery: string;
  pathError: string | null;
  pathMatches: ResolvedTreePath[];
  currentPathMatchIndex: number;
  currentMatchIndex: number;
  recordFilter: "all" | "matches" | "errors" | "nested" | "tool" | "message" | "events";
  commandInput: string;
}

export const isPathLikeQuery = (value: string) =>
  /^\s*[$.[\]]/.test(value) || value.trimStart().startsWith(".");

export const resolveQueryMode = (value: string): QueryMode =>
  isPathLikeQuery(value) ? "path" : "search";

export const createInitialQueryInteractionState = (): QueryInteractionState => ({
  toolbarQuery: "",
  searchQuery: "",
  searchRegex: false,
  searchCaseSensitive: false,
  searchJq: false,
  pathQuery: "",
  pathError: null,
  pathMatches: [],
  currentPathMatchIndex: 0,
  currentMatchIndex: 0,
  recordFilter: "all",
  commandInput: "",
});

export type SearchOptionKind = "regex" | "caseSensitive" | "jq";

// Path resolution needs the current record set, which only the caller has at
// dispatch time — so it happens in the hook callback and the reducer receives
// the outcome, staying a pure state transition.
export type PathResolution =
  | { query: string; ok: true; targets: ResolvedTreePath[] }
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
      const value = action.value;
      if (!value.trim()) {
        return {
          ...state,
          toolbarQuery: value,
          pathError: null,
          searchQuery: "",
          pathQuery: "",
          pathMatches: [],
          currentPathMatchIndex: 0,
          currentMatchIndex: 0,
        };
      }

      if (isPathLikeQuery(value)) {
        return {
          ...state,
          toolbarQuery: value,
          pathError: null,
          pathQuery: value,
          pathMatches: [],
          currentPathMatchIndex: 0,
          searchQuery: "",
          currentMatchIndex: 0,
        };
      }

      return {
        ...state,
        toolbarQuery: value,
        pathError: null,
        pathQuery: "",
        pathMatches: [],
        currentPathMatchIndex: 0,
        searchQuery: value,
        currentMatchIndex: 0,
      };
    }

    case "submitToolbarQuery": {
      if (!action.resolution) {
        return { ...state, toolbarQuery: action.value };
      }

      return applyPathResolution(state, action.value, action.resolution);
    }

    case "overviewPathSelect": {
      if (!action.resolution) {
        return { ...state, toolbarQuery: action.value, recordFilter: "all" };
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
        searchQuery: "",
        pathQuery: "",
        pathError: null,
        pathMatches: [],
        currentPathMatchIndex: 0,
        currentMatchIndex: 0,
      };
    }

    case "commandSearch": {
      return {
        ...state,
        toolbarQuery: action.value,
        searchQuery: action.value,
        recordFilter: "matches",
        currentMatchIndex: 0,
      };
    }

    case "overviewFieldValueSearch": {
      return {
        ...state,
        toolbarQuery: action.value,
        searchQuery: action.value,
        searchRegex: false,
        searchCaseSensitive: false,
        searchJq: false,
        recordFilter: "matches",
        currentMatchIndex: 0,
      };
    }

    case "setSearchOption": {
      // jq and regex are mutually exclusive: enabling one clears the other.
      if (action.kind === "jq" && action.on) {
        return { ...state, searchJq: true, searchRegex: false, currentMatchIndex: 0 };
      }
      if (action.kind === "regex" && action.on) {
        return { ...state, searchRegex: true, searchJq: false, currentMatchIndex: 0 };
      }
      if (action.kind === "jq") {
        return { ...state, searchJq: action.on, currentMatchIndex: 0 };
      }
      if (action.kind === "regex") {
        return { ...state, searchRegex: action.on, currentMatchIndex: 0 };
      }
      return { ...state, searchCaseSensitive: action.on, currentMatchIndex: 0 };
    }

    case "setRecordFilter": {
      if (state.recordFilter === action.filter) {
        return state;
      }

      return {
        ...state,
        recordFilter: action.filter,
        pathError: null,
        pathMatches: [],
        currentPathMatchIndex: 0,
        currentMatchIndex: 0,
      };
    }

    case "setCommandInput": {
      return { ...state, commandInput: action.value };
    }

    case "seedCommandInput": {
      return {
        ...state,
        commandInput: state.toolbarQuery || state.searchQuery || state.pathQuery,
      };
    }

    case "prevMatch": {
      const matchCount = action.matchCount;
      if (matchCount === 0) {
        return state;
      }
      const currentMatchIndex = reconcileMatchIndex(state.currentMatchIndex, matchCount);
      return {
        ...state,
        currentMatchIndex: (currentMatchIndex - 1 + matchCount) % matchCount,
      };
    }

    case "nextMatch": {
      const matchCount = action.matchCount;
      if (matchCount === 0) {
        return state;
      }
      const currentMatchIndex = reconcileMatchIndex(state.currentMatchIndex, matchCount);
      return {
        ...state,
        currentMatchIndex: (currentMatchIndex + 1) % matchCount,
      };
    }

    case "prevPathMatch": {
      if (state.pathMatches.length === 0) {
        return state;
      }
      const next =
        (state.currentPathMatchIndex - 1 + state.pathMatches.length) % state.pathMatches.length;
      return { ...state, currentPathMatchIndex: next };
    }

    case "nextPathMatch": {
      if (state.pathMatches.length === 0) {
        return state;
      }
      const next = (state.currentPathMatchIndex + 1) % state.pathMatches.length;
      return { ...state, currentPathMatchIndex: next };
    }

    case "resetAll": {
      return createInitialQueryInteractionState();
    }

    default:
      return state;
  }
};

// Shared transition for path jumps driven by toolbar submit, palette submit,
// or overview selection: either records the error or lands on the first target.
const applyPathResolution = (
  state: QueryInteractionState,
  toolbarValue: string,
  resolution: PathResolution,
): QueryInteractionState => ({
  ...state,
  toolbarQuery: toolbarValue,
  pathQuery: resolution.query,
  searchQuery: "",
  currentMatchIndex: 0,
  currentPathMatchIndex: 0,
  pathError: resolution.ok ? null : resolution.error,
  pathMatches: resolution.ok ? resolution.targets : [],
});
