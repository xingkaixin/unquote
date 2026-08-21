import { describe, expect, it } from "vitest";
import {
  createInitialQueryInteractionState,
  isPathLikeQuery,
  reconcileMatchIndex,
  reduceQueryInteraction,
} from "../src/lib/query-interaction";
import type { PathResolution, QueryInteractionState } from "../src/lib/query-interaction";
import type { TreePathMatch } from "../src/lib/tree-path";

const okPath = (query: string, targets: TreePathMatch[]): PathResolution => ({
  query,
  ok: true,
  targets,
});

const errPath = (query: string, error: string): PathResolution => ({
  query,
  ok: false,
  error,
});

const searchState = (query = "needle", currentMatchIndex = 0): QueryInteractionState => ({
  ...createInitialQueryInteractionState(),
  toolbarQuery: query,
  modeState: { mode: "search", query, currentMatchIndex },
});

const pathState = (
  query = "$.payload",
  matches: TreePathMatch[] = [],
  currentIndex = 0,
  error: string | null = null,
): QueryInteractionState => ({
  ...createInitialQueryInteractionState(),
  toolbarQuery: query,
  modeState: { mode: "path", query, error, matches, currentIndex },
});

const target = {
  recordId: "rec-1",
  pathText: "$.payload",
} satisfies TreePathMatch;

describe("query-interaction", () => {
  it("detects path-like input", () => {
    expect(isPathLikeQuery("$.payload")).toBe(true);
    expect(isPathLikeQuery(".payload")).toBe(true);
    expect(isPathLikeQuery("[0]")).toBe(true);
    expect(isPathLikeQuery("  $.x")).toBe(true);
    expect(isPathLikeQuery("needle")).toBe(false);
    expect(isPathLikeQuery("")).toBe(false);
  });

  it("starts in an explicit idle mode", () => {
    expect(createInitialQueryInteractionState()).toMatchObject({
      toolbarQuery: "",
      modeState: { mode: "idle" },
      recordFilter: "all",
      commandInput: "",
    });
  });

  it("replaces the active member when switching between search and path", () => {
    let state = reduceQueryInteraction(createInitialQueryInteractionState(), {
      type: "toolbarQueryChange",
      value: "needle",
    });
    expect(state.modeState).toEqual({
      mode: "search",
      query: "needle",
      currentMatchIndex: 0,
    });

    state = reduceQueryInteraction(state, {
      type: "toolbarQueryChange",
      value: "$.payload",
    });
    expect(state.modeState).toEqual({
      mode: "path",
      query: "$.payload",
      error: null,
      matches: [],
      currentIndex: 0,
    });

    state = reduceQueryInteraction(state, {
      type: "toolbarQueryChange",
      value: "next",
    });
    expect(state.modeState).toEqual({
      mode: "search",
      query: "next",
      currentMatchIndex: 0,
    });
  });

  it("moves blank input and clear actions to idle mode", () => {
    const blank = reduceQueryInteraction(searchState(), {
      type: "toolbarQueryChange",
      value: "   ",
    });
    expect(blank.modeState).toEqual({ mode: "idle" });

    const cleared = reduceQueryInteraction(pathState("$.payload", [target]), {
      type: "clearToolbarQuery",
    });
    expect(cleared.toolbarQuery).toBe("");
    expect(cleared.modeState).toEqual({ mode: "idle" });
  });

  it("represents text, jq, and regex as one active syntax", () => {
    const base = searchState("needle", 2);
    const afterJq = reduceQueryInteraction(base, {
      type: "setSearchOption",
      kind: "jq",
      on: true,
    });
    expect(afterJq.searchSyntax).toBe("jq");
    expect(afterJq.modeState).toMatchObject({ mode: "search", currentMatchIndex: 0 });

    const afterRegex = reduceQueryInteraction(afterJq, {
      type: "setSearchOption",
      kind: "regex",
      on: true,
    });
    expect(afterRegex.searchSyntax).toBe("regex");

    const back = reduceQueryInteraction(afterRegex, {
      type: "setSearchOption",
      kind: "jq",
      on: true,
    });
    expect(back.searchSyntax).toBe("jq");

    const caseSensitive = reduceQueryInteraction(base, {
      type: "setSearchOption",
      kind: "caseSensitive",
      on: true,
    });
    expect(caseSensitive.searchCaseSensitive).toBe(true);
    expect(caseSensitive.searchSyntax).toBe("text");
  });

  it("applies a successful path resolution and lands on the first target", () => {
    const state = reduceQueryInteraction(searchState(), {
      type: "submitToolbarQuery",
      value: "$.payload",
      resolution: okPath("$.payload", [target]),
    });
    expect(state.modeState).toEqual({
      mode: "path",
      query: "$.payload",
      error: null,
      matches: [target],
      currentIndex: 0,
    });
  });

  it("records path resolution errors in the path member", () => {
    const state = reduceQueryInteraction(createInitialQueryInteractionState(), {
      type: "submitToolbarQuery",
      value: "$.payload",
      resolution: errPath("$.payload", "INVALID"),
    });
    expect(state.modeState).toEqual({
      mode: "path",
      query: "$.payload",
      error: "INVALID",
      matches: [],
      currentIndex: 0,
    });
  });

  it("preserves search navigation when submitting the active text query", () => {
    const base = { ...searchState("needle", 2), toolbarQuery: "" };
    const state = reduceQueryInteraction(base, {
      type: "submitToolbarQuery",
      value: "needle",
      resolution: null,
    });
    expect(state).toEqual({ ...base, toolbarQuery: "needle" });
  });

  it("cycles search match indices with wrap-around", () => {
    let state = searchState();
    state = reduceQueryInteraction(state, { type: "nextMatch", matchCount: 3 });
    expect(state.modeState).toMatchObject({ mode: "search", currentMatchIndex: 1 });
    state = reduceQueryInteraction(state, { type: "nextMatch", matchCount: 3 });
    expect(state.modeState).toMatchObject({ mode: "search", currentMatchIndex: 2 });
    state = reduceQueryInteraction(state, { type: "nextMatch", matchCount: 3 });
    expect(state.modeState).toMatchObject({ mode: "search", currentMatchIndex: 0 });
    state = reduceQueryInteraction(state, { type: "prevMatch", matchCount: 3 });
    expect(state.modeState).toMatchObject({ mode: "search", currentMatchIndex: 2 });
  });

  it("ignores search navigation outside search mode or without matches", () => {
    const idle = createInitialQueryInteractionState();
    expect(reduceQueryInteraction(idle, { type: "nextMatch", matchCount: 3 })).toBe(idle);

    const search = searchState();
    expect(reduceQueryInteraction(search, { type: "nextMatch", matchCount: 0 })).toBe(search);
  });

  it("reconciles the match index with the visible match count", () => {
    expect(reconcileMatchIndex(5, 2)).toBe(1);
    expect(reconcileMatchIndex(5, 0)).toBe(0);
    expect(reconcileMatchIndex(1, 2)).toBe(1);
  });

  it("navigates from the reconciled search index", () => {
    const state = searchState("needle", 5);
    const previous = reduceQueryInteraction(state, { type: "prevMatch", matchCount: 3 });
    const next = reduceQueryInteraction(state, { type: "nextMatch", matchCount: 3 });

    expect(previous.modeState).toMatchObject({ mode: "search", currentMatchIndex: 1 });
    expect(next.modeState).toMatchObject({ mode: "search", currentMatchIndex: 0 });
  });

  it("cycles path targets inside the path member", () => {
    const secondTarget = { ...target, recordId: "rec-2" };
    let state = pathState("$.payload", [target, secondTarget]);
    state = reduceQueryInteraction(state, { type: "nextPathMatch" });
    expect(state.modeState).toMatchObject({ mode: "path", currentIndex: 1 });
    state = reduceQueryInteraction(state, { type: "nextPathMatch" });
    expect(state.modeState).toMatchObject({ mode: "path", currentIndex: 0 });
    state = reduceQueryInteraction(state, { type: "prevPathMatch" });
    expect(state.modeState).toMatchObject({ mode: "path", currentIndex: 1 });
  });

  it("resets only the active member's navigation when changing filters", () => {
    const path = {
      ...pathState("$.payload", [target], 1, "NOT_FOUND"),
      recordFilter: "matches" as const,
    };
    expect(reduceQueryInteraction(path, { type: "setRecordFilter", filter: "errors" })).toEqual({
      ...path,
      recordFilter: "errors",
      modeState: {
        mode: "path",
        query: "$.payload",
        error: null,
        matches: [],
        currentIndex: 0,
      },
    });

    const search = {
      ...searchState("needle", 2),
      recordFilter: "matches" as const,
    };
    expect(
      reduceQueryInteraction(search, { type: "setRecordFilter", filter: "errors" }).modeState,
    ).toEqual({ mode: "search", query: "needle", currentMatchIndex: 0 });
  });

  it("replaces path state when command search starts", () => {
    const state = reduceQueryInteraction(pathState("$.payload", [target]), {
      type: "commandSearch",
      value: "boom",
    });
    expect(state.modeState).toEqual({
      mode: "search",
      query: "boom",
      currentMatchIndex: 0,
    });
    expect(state.toolbarQuery).toBe("boom");
    expect(state.recordFilter).toBe("matches");
  });

  it("resetAll returns to the initial idle state", () => {
    const dirty = {
      ...searchState("x", 3),
      recordFilter: "matches" as const,
    };
    expect(reduceQueryInteraction(dirty, { type: "resetAll" })).toEqual(
      createInitialQueryInteractionState(),
    );
  });

  it("seeds command input from the active query", () => {
    let state = reduceQueryInteraction(pathState("$.x"), { type: "seedCommandInput" });
    expect(state.commandInput).toBe("$.x");

    state = reduceQueryInteraction(
      { ...searchState("boom"), toolbarQuery: "" },
      { type: "seedCommandInput" },
    );
    expect(state.commandInput).toBe("boom");
  });
});
