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

export type QueryInteractionAction =
  | { type: "toolbarQueryChange"; value: string }
  | { type: "submitToolbarQuery"; value: string }
  | { type: "clearToolbarQuery" }
  | { type: "commandSearch"; value: string }
  | { type: "overviewPathSelect"; value: string }
  | { type: "overviewFieldValueSearch"; value: string }
  | { type: "setSearchOption"; kind: SearchOptionKind; on: boolean }
  | { type: "setRecordFilter"; filter: QueryInteractionState["recordFilter"] }
  | { type: "setCommandInput"; value: string }
  | { type: "seedCommandInput" }
  | { type: "prevMatch"; matchCount: number }
  | { type: "nextMatch"; matchCount: number }
  | { type: "prevPathMatch" }
  | { type: "nextPathMatch" }
  | { type: "clampMatchIndex"; matchCount: number }
  | { type: "resetMatchIndex" }
  | { type: "resetPathForFilter" }
  | { type: "clearPathMatches" }
  | { type: "resetAll" };

export interface ResolvePathResult {
  ok: boolean;
  reason?: "invalid" | "not-found";
  targets: ResolvedTreePath[];
}

export interface QueryInteractionContext {
  resolvePath: (records: unknown, query: string) => ResolvePathResult;
  visibleRecords: unknown;
  allRecords: unknown;
  translateError: (reason: "invalid" | "not-found") => string;
}

export const reduceQueryInteraction = (
  state: QueryInteractionState,
  action: QueryInteractionAction,
  ctx: QueryInteractionContext,
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
      };
    }

    case "submitToolbarQuery": {
      const query = action.value.trim();
      if (!query || !isPathLikeQuery(query)) {
        // Search mode: re-navigate to the current match (no state change beyond
        // the toolbar value); the hook bumps the nav version so the app re-scrolls.
        return { ...state, toolbarQuery: action.value };
      }

      return resolvePathIntoState(
        state,
        { toolbarValue: action.value, query, records: ctx.visibleRecords },
        ctx,
      );
    }

    case "overviewPathSelect": {
      const query = action.value.trim();
      if (!query) {
        return { ...state, toolbarQuery: action.value, recordFilter: "all" };
      }

      return resolvePathIntoState(
        { ...state, recordFilter: "all" },
        { toolbarValue: action.value, query, records: ctx.allRecords },
        ctx,
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
        return { ...state, searchJq: true, searchRegex: false };
      }
      if (action.kind === "regex" && action.on) {
        return { ...state, searchRegex: true, searchJq: false };
      }
      if (action.kind === "jq") {
        return { ...state, searchJq: action.on };
      }
      if (action.kind === "regex") {
        return { ...state, searchRegex: action.on };
      }
      return { ...state, searchCaseSensitive: action.on };
    }

    case "setRecordFilter": {
      return { ...state, recordFilter: action.filter };
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
      return {
        ...state,
        currentMatchIndex: (state.currentMatchIndex - 1 + matchCount) % matchCount,
      };
    }

    case "nextMatch": {
      const matchCount = action.matchCount;
      if (matchCount === 0) {
        return state;
      }
      return {
        ...state,
        currentMatchIndex: (state.currentMatchIndex + 1) % matchCount,
      };
    }

    case "prevPathMatch": {
      if (state.pathMatches.length === 0) {
        return state;
      }
      const next = (state.currentPathMatchIndex - 1 + state.pathMatches.length) %
        state.pathMatches.length;
      return { ...state, currentPathMatchIndex: next };
    }

    case "nextPathMatch": {
      if (state.pathMatches.length === 0) {
        return state;
      }
      const next = (state.currentPathMatchIndex + 1) % state.pathMatches.length;
      return { ...state, currentPathMatchIndex: next };
    }

    case "clampMatchIndex": {
      const matchCount = action.matchCount;
      const next = matchCount === 0 ? 0 : Math.min(state.currentMatchIndex, matchCount - 1);
      return { ...state, currentMatchIndex: next };
    }

    case "resetMatchIndex": {
      return { ...state, currentMatchIndex: 0 };
    }

    case "resetPathForFilter": {
      return {
        ...state,
        pathError: null,
        pathMatches: [],
        currentPathMatchIndex: 0,
      };
    }

    case "resetAll": {
      return createInitialQueryInteractionState();
    }

    case "clearPathMatches": {
      return { ...state, pathMatches: [], currentPathMatchIndex: 0 };
    }

    default:
      return state;
  }
};

// Shared transition for path jumps driven by toolbar submit, palette submit,
// or overview selection. Resolves the path against the given record set and
// either records the error or lands on the first target.
const resolvePathIntoState = (
  state: QueryInteractionState,
  jump: { toolbarValue: string; query: string; records: unknown },
  ctx: QueryInteractionContext,
): QueryInteractionState => {
  const resolved = ctx.resolvePath(jump.records, jump.query);
  if (!resolved.ok) {
    return {
      ...state,
      toolbarQuery: jump.toolbarValue,
      pathQuery: jump.query,
      searchQuery: "",
      currentMatchIndex: 0,
      currentPathMatchIndex: 0,
      pathError: ctx.translateError(resolved.reason ?? "not-found"),
      pathMatches: [],
    };
  }

  return {
    ...state,
    toolbarQuery: jump.toolbarValue,
    pathQuery: jump.query,
    searchQuery: "",
    currentMatchIndex: 0,
    currentPathMatchIndex: 0,
    pathError: null,
    pathMatches: resolved.targets,
  };
};
