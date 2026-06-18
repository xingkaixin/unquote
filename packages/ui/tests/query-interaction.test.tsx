import { describe, expect, it } from "vitest";
import type { ResolvedTreePath } from "../src/lib/tree";
import {
  createInitialQueryInteractionState,
  isPathLikeQuery,
  reduceQueryInteraction,
  resolveQueryMode,
} from "../src/lib/query-interaction";
import type { QueryInteractionContext, ResolvePathResult } from "../src/lib/query-interaction";

const okPath = (targets: ResolvedTreePath[]): ResolvePathResult => ({ ok: true, targets });
const errPath = (reason: "invalid" | "not-found"): ResolvePathResult => ({
  ok: false,
  reason,
  targets: [],
});

const makeCtx = (
  overrides: Partial<QueryInteractionContext> = {},
): QueryInteractionContext => ({
  visibleRecords: [],
  allRecords: [],
  resolvePath: (): ResolvePathResult => ({ ok: false, reason: "not-found", targets: [] }),
  translateError: (reason) => (reason === "invalid" ? "INVALID" : "NOT_FOUND"),
  ...overrides,
});

describe("query-interaction", () => {
  it("detects path vs search mode", () => {
    expect(isPathLikeQuery("$.payload")).toBe(true);
    expect(isPathLikeQuery(".payload")).toBe(true);
    expect(isPathLikeQuery("[0]")).toBe(true);
    expect(isPathLikeQuery("  $.x")).toBe(true);
    expect(isPathLikeQuery("needle")).toBe(false);
    expect(isPathLikeQuery("")).toBe(false);
    expect(resolveQueryMode("$.x")).toBe("path");
    expect(resolveQueryMode("needle")).toBe("search");
  });

  it("has empty defaults", () => {
    const state = createInitialQueryInteractionState();
    expect(state.toolbarQuery).toBe("");
    expect(state.searchQuery).toBe("");
    expect(state.recordFilter).toBe("all");
    expect(state.pathMatches).toEqual([]);
    expect(state.currentMatchIndex).toBe(0);
  });

  it("routes a path-like toolbar change into path mode", () => {
    const state = reduceQueryInteraction(
      createInitialQueryInteractionState(),
      { type: "toolbarQueryChange", value: "$.payload" },
      makeCtx(),
    );
    expect(state.toolbarQuery).toBe("$.payload");
    expect(state.pathQuery).toBe("$.payload");
    expect(state.searchQuery).toBe("");
    expect(state.pathMatches).toEqual([]);
  });

  it("routes a text toolbar change into search mode", () => {
    const state = reduceQueryInteraction(
      createInitialQueryInteractionState(),
      { type: "toolbarQueryChange", value: "needle" },
      makeCtx(),
    );
    expect(state.searchQuery).toBe("needle");
    expect(state.pathQuery).toBe("");
  });

  it("clears every query field on clear", () => {
    const state = reduceQueryInteraction(
      { ...createInitialQueryInteractionState(), searchQuery: "x", pathQuery: "$", pathMatches: [] },
      { type: "clearToolbarQuery" },
      makeCtx(),
    );
    expect(state.searchQuery).toBe("");
    expect(state.pathQuery).toBe("");
    expect(state.toolbarQuery).toBe("");
    expect(state.currentMatchIndex).toBe(0);
  });

  it("enforces jq and regex mutual exclusion in both directions", () => {
    const base = createInitialQueryInteractionState();
    const afterJq = reduceQueryInteraction(base, { type: "setSearchOption", kind: "jq", on: true }, makeCtx());
    expect(afterJq.searchJq).toBe(true);
    expect(afterJq.searchRegex).toBe(false);

    // Turning regex on while jq is on clears jq.
    const afterRegex = reduceQueryInteraction(
      afterJq,
      { type: "setSearchOption", kind: "regex", on: true },
      makeCtx(),
    );
    expect(afterRegex.searchRegex).toBe(true);
    expect(afterRegex.searchJq).toBe(false);

    // Turning jq back on clears regex again.
    const back = reduceQueryInteraction(afterRegex, { type: "setSearchOption", kind: "jq", on: true }, makeCtx());
    expect(back.searchJq).toBe(true);
    expect(back.searchRegex).toBe(false);

    // caseSensitive is independent.
    const cs = reduceQueryInteraction(base, { type: "setSearchOption", kind: "caseSensitive", on: true }, makeCtx());
    expect(cs.searchCaseSensitive).toBe(true);
    expect(cs.searchJq).toBe(false);
  });

  it("resolves a path jump against visible records and lands on the first target", () => {
    const target = {
      recordId: "rec-1",
      pathText: "$.payload",
      stringifiedPathChain: [],
    } as unknown as ResolvedTreePath;
    const ctx = makeCtx({
      resolvePath: () => okPath([target]),
    });
    const state = reduceQueryInteraction(
      createInitialQueryInteractionState(),
      { type: "submitToolbarQuery", value: "$.payload" },
      ctx,
    );
    expect(state.pathMatches).toEqual([target]);
    expect(state.currentMatchIndex).toBe(0);
    expect(state.searchQuery).toBe("");
    expect(state.pathError).toBeNull();
  });

  it("records a translated error when the path does not resolve", () => {
    const ctx = makeCtx({ resolvePath: () => errPath("invalid") });
    const state = reduceQueryInteraction(
      createInitialQueryInteractionState(),
      { type: "submitToolbarQuery", value: "$.payload" },
      ctx,
    );
    expect(state.pathError).toBe("INVALID");
    expect(state.pathMatches).toEqual([]);
  });

  it("cycles match indices with wrap-around", () => {
    let state = createInitialQueryInteractionState();
    state = reduceQueryInteraction(state, { type: "nextMatch", matchCount: 3 }, makeCtx());
    expect(state.currentMatchIndex).toBe(1);
    state = reduceQueryInteraction(state, { type: "nextMatch", matchCount: 3 }, makeCtx());
    expect(state.currentMatchIndex).toBe(2);
    state = reduceQueryInteraction(state, { type: "nextMatch", matchCount: 3 }, makeCtx());
    expect(state.currentMatchIndex).toBe(0);
    state = reduceQueryInteraction(state, { type: "prevMatch", matchCount: 3 }, makeCtx());
    expect(state.currentMatchIndex).toBe(2);
  });

  it("no-ops match navigation when there are no matches", () => {
    const state = reduceQueryInteraction(
      createInitialQueryInteractionState(),
      { type: "nextMatch", matchCount: 0 },
      makeCtx(),
    );
    expect(state.currentMatchIndex).toBe(0);
  });

  it("clamps the match index to the current match count", () => {
    let state = { ...createInitialQueryInteractionState(), currentMatchIndex: 5 };
    state = reduceQueryInteraction(state, { type: "clampMatchIndex", matchCount: 2 }, makeCtx());
    expect(state.currentMatchIndex).toBe(1);
    state = reduceQueryInteraction(state, { type: "clampMatchIndex", matchCount: 0 }, makeCtx());
    expect(state.currentMatchIndex).toBe(0);
  });

  it("commandSearch switches the filter to matches", () => {
    const state = reduceQueryInteraction(
      createInitialQueryInteractionState(),
      { type: "commandSearch", value: "boom" },
      makeCtx(),
    );
    expect(state.searchQuery).toBe("boom");
    expect(state.toolbarQuery).toBe("boom");
    expect(state.recordFilter).toBe("matches");
  });

  it("overviewFieldValueSearch clears search options", () => {
    const base = {
      ...createInitialQueryInteractionState(),
      searchRegex: true,
      searchJq: false,
      searchCaseSensitive: true,
    };
    const state = reduceQueryInteraction(
      base,
      { type: "overviewFieldValueSearch", value: "boom" },
      makeCtx(),
    );
    expect(state.searchRegex).toBe(false);
    expect(state.searchCaseSensitive).toBe(false);
    expect(state.searchJq).toBe(false);
    expect(state.recordFilter).toBe("matches");
  });

  it("resetAll returns to the initial state", () => {
    const dirty = {
      ...createInitialQueryInteractionState(),
      searchQuery: "x",
      recordFilter: "matches" as const,
      currentMatchIndex: 3,
    };
    const state = reduceQueryInteraction(dirty, { type: "resetAll" }, makeCtx());
    expect(state).toEqual(createInitialQueryInteractionState());
  });

  it("seeds commandInput from the active query", () => {
    let state = { ...createInitialQueryInteractionState(), toolbarQuery: "$.x", searchQuery: "" };
    state = reduceQueryInteraction(state, { type: "seedCommandInput" }, makeCtx());
    expect(state.commandInput).toBe("$.x");

    state = { ...createInitialQueryInteractionState(), toolbarQuery: "", searchQuery: "boom" };
    state = reduceQueryInteraction(state, { type: "seedCommandInput" }, makeCtx());
    expect(state.commandInput).toBe("boom");
  });
});
