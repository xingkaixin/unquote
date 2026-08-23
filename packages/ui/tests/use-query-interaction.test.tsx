import { act, renderHook, waitFor } from "@testing-library/react";
import type { ParseResult } from "@unquote/core";
import { parseInput } from "@unquote/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memorySearchDebounceMs, useQueryInteraction } from "../src/hooks/use-query-interaction";
import { createTextSourceRevision } from "../src/lib/published-source";
import type { SourceRevision } from "../src/lib/source-revision";

const source = '{"payload":"needle"}\n{"payload":"needle"}';
const result = parseInput(source, { forcedFormat: "jsonl" });

const createSource = (text: string, revision = 0) =>
  createTextSourceRevision(revision, text, "jsonl");

const renderQuery = () =>
  renderHook(() =>
    useQueryInteraction({
      source: createSource(source),
      resultRevision: 0,
      result,
      translateError: (reason) => reason,
    }),
  );

interface RevisionedQueryProps {
  sourceRevision: SourceRevision;
  parseResult: ParseResult;
}

const renderRevisionedQuery = (initialProps: RevisionedQueryProps) =>
  renderHook(
    ({ sourceRevision, parseResult }: RevisionedQueryProps) =>
      useQueryInteraction({
        source: createSource(source, sourceRevision),
        resultRevision: sourceRevision,
        result: parseResult,
        translateError: (reason) => reason,
      }),
    { initialProps },
  );

describe("useQueryInteraction", () => {
  beforeEach(() => {
    Reflect.deleteProperty(globalThis, "Worker");
  });

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(globalThis, "Worker");
  });

  it("debounces in-memory searches", async () => {
    vi.useFakeTimers();
    const { result: query } = renderQuery();

    act(() => query.current.intent.searchFromCommand("needle"));
    expect(query.current.snapshot.searchStatus).toBe("pending");

    await act(() => vi.advanceTimersByTimeAsync(memorySearchDebounceMs - 1));
    expect(query.current.snapshot.searchStatus).toBe("pending");

    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(query.current.snapshot.searchStatus).toBe("complete");
  });

  it("owns search results, filtering, and match navigation behind its interface", async () => {
    const { result: query } = renderQuery();

    act(() => query.current.intent.searchFromCommand("needle"));

    await waitFor(() => expect(query.current.snapshot.searchStatus).toBe("complete"));
    expect(query.current.snapshot).toMatchObject({
      mode: "search",
      recordFilter: "matches",
      matchCount: 2,
      currentMatchIndex: 0,
      activeSearchMatch: {
        recordId: "record-1",
        pathText: "$.payload",
      },
    });
    expect(query.current.snapshot.visibleRecords).toHaveLength(2);
    const firstRequestId = query.current.navigation?.requestId;

    act(() => query.current.intent.nextResult());
    expect(query.current.snapshot.currentMatchIndex).toBe(1);
    expect(query.current.navigation).toEqual({
      requestId: expect.any(Number),
      target: {
        sourceRevision: 0,
        kind: "search",
        recordId: "record-2",
        pathText: "$.payload",
      },
    });
    expect(query.current.navigation!.requestId).toBeGreaterThan(firstRequestId!);
    expect(query.current.snapshot.activeSearchMatch).toMatchObject({
      recordId: "record-2",
      pathText: "$.payload",
    });
  });

  it("updates record derivations from immutable parser snapshots", () => {
    const firstResult = parseInput('{"message":"first"}', { forcedFormat: "jsonl" });
    const nextResult = parseInput('{"message":"first"}\n{"message":"second"}', {
      forcedFormat: "jsonl",
    });
    const { result: query, rerender } = renderHook(
      ({ parseResult }) =>
        useQueryInteraction({
          source: createSource(""),
          resultRevision: 0,
          result: parseResult,
          translateError: (reason) => reason,
        }),
      { initialProps: { parseResult: firstResult } },
    );

    expect(query.current.snapshot.visibleRecords).toHaveLength(1);
    expect(query.current.snapshot.recordsById).toHaveLength(1);
    expect(query.current.snapshot.fileOverview.total).toBe(1);

    rerender({ parseResult: nextResult });

    expect(query.current.snapshot.visibleRecords).toHaveLength(2);
    expect(query.current.snapshot.recordsById).toHaveLength(2);
    expect(query.current.snapshot.fileOverview.total).toBe(2);
  });

  it("keeps a clear request stable when parser records change", () => {
    const firstResult = parseInput('{"message":"first"}', { forcedFormat: "jsonl" });
    const nextResult = parseInput('{"message":"first"}\n{"message":"second"}', {
      forcedFormat: "jsonl",
    });
    const { result: query, rerender } = renderHook(
      ({ parseResult }) =>
        useQueryInteraction({
          source: createSource(""),
          resultRevision: 0,
          result: parseResult,
          translateError: (reason) => reason,
        }),
      { initialProps: { parseResult: firstResult } },
    );

    act(() => query.current.intent.setFilter("message"));
    const clearRequest = query.current.navigation;

    rerender({ parseResult: nextResult });

    expect(query.current.navigation).toBe(clearRequest);
  });

  it("reissues repeated path navigation through its interface", () => {
    const { result: query } = renderQuery();

    act(() => query.current.intent.submitToolbarQuery("$.payload"));
    expect(query.current.snapshot.activeSearchMatch).toBeNull();
    expect(query.current.navigation?.target).toEqual({
      sourceRevision: 0,
      kind: "path",
      target: expect.objectContaining({
        recordId: "record-1",
        pathText: "$.payload",
      }),
    });
    const firstRequestId = query.current.navigation!.requestId;
    const searchExpansionRevision = query.current.searchExpansionRevision;
    expect(searchExpansionRevision).toBe(0);

    act(() => query.current.intent.submitToolbarQuery("$.payload"));
    expect(query.current.navigation!.requestId).toBeGreaterThan(firstRequestId);
    expect(query.current.navigation?.target.kind).toBe("path");
    expect(query.current.searchExpansionRevision).toBe(searchExpansionRevision);
  });

  it("versions navigation requests independently from search expansion", async () => {
    const { result: query } = renderQuery();

    act(() => query.current.intent.setFilter("message"));
    expect(query.current.navigation?.requestId).toBe(1);
    expect(query.current.searchExpansionRevision).toBe(0);

    act(() => query.current.intent.searchFromCommand("needle"));
    await waitFor(() => expect(query.current.snapshot.searchStatus).toBe("complete"));
    const firstSearchRevision = query.current.searchExpansionRevision;

    act(() => query.current.intent.changeCommandInput("unrelated"));
    expect(query.current.searchExpansionRevision).toBe(firstSearchRevision);

    act(() => query.current.intent.nextResult());
    expect(query.current.searchExpansionRevision).toBe(firstSearchRevision + 1);
  });

  it("stores lightweight path matches and resolves only the active navigation target", () => {
    const { result: query } = renderQuery();

    act(() => query.current.intent.submitToolbarQuery("$.payload"));

    expect(query.current.snapshot.pathMatches).toEqual([
      { recordId: "record-1", pathText: "$.payload" },
      { recordId: "record-2", pathText: "$.payload" },
    ]);
    expect(query.current.navigation?.target).toEqual({
      sourceRevision: 0,
      kind: "path",
      target: expect.objectContaining({
        recordId: "record-1",
        pathText: "$.payload",
        rawKey: "payload",
        node: expect.objectContaining({ value: "needle" }),
      }),
    });

    act(() => query.current.intent.nextResult());

    expect(query.current.snapshot.currentPathMatchIndex).toBe(1);
    expect(query.current.navigation?.target).toEqual({
      sourceRevision: 0,
      kind: "path",
      target: expect.objectContaining({
        recordId: "record-2",
        pathText: "$.payload",
      }),
    });
  });

  it("keeps regex and jq mutually exclusive through option intents", () => {
    const { result: query } = renderQuery();

    act(() => query.current.intent.setOption("jq", true));
    expect(query.current.snapshot).toMatchObject({ searchJq: true, searchRegex: false });

    act(() => query.current.intent.setOption("regex", true));
    expect(query.current.snapshot).toMatchObject({ searchJq: false, searchRegex: true });
  });

  it("cancels query navigation while revealing all Records for an endpoint", async () => {
    const { result: query, rerender } = renderRevisionedQuery({
      sourceRevision: 0,
      parseResult: result,
    });

    act(() => query.current.intent.searchFromCommand("needle"));
    await waitFor(() => expect(query.current.snapshot.searchStatus).toBe("complete"));
    act(() => query.current.intent.revealAllRecords());
    expect(query.current.snapshot).toMatchObject({
      recordFilter: "all",
      searchQuery: "needle",
    });
    expect(query.current.navigation).toBeNull();

    rerender({
      sourceRevision: 0,
      parseResult: parseInput(source, { forcedFormat: "jsonl" }),
    });
    await act(async () => undefined);

    expect(query.current.navigation).toBeNull();

    act(() => query.current.intent.nextResult());
    await waitFor(() =>
      expect(query.current.navigation?.target).toEqual({
        sourceRevision: 0,
        kind: "search",
        recordId: "record-2",
        pathText: "$.payload",
      }),
    );
  });

  it("does not carry a canceled navigation into a new Source Revision", async () => {
    const { result: query, rerender } = renderRevisionedQuery({
      sourceRevision: 0,
      parseResult: result,
    });

    act(() => query.current.intent.searchFromCommand("needle"));
    await waitFor(() => expect(query.current.snapshot.searchStatus).toBe("complete"));
    act(() => query.current.intent.revealAllRecords());
    expect(query.current.navigation).toBeNull();

    rerender({ sourceRevision: 1, parseResult: result });
    expect(query.current.navigation).toBeNull();
    act(() => query.current.intent.searchFromCommand("needle"));

    await waitFor(() =>
      expect(query.current.navigation?.target).toEqual({
        sourceRevision: 1,
        kind: "search",
        recordId: "record-1",
        pathText: "$.payload",
      }),
    );
  });

  it("ignores query intents retained from an obsolete Source Revision", () => {
    const { result: query, rerender } = renderRevisionedQuery({
      sourceRevision: 0,
      parseResult: result,
    });
    const obsoleteIntent = query.current.intent;

    rerender({ sourceRevision: 1, parseResult: result });
    act(() => query.current.intent.setFilter("message"));
    expect(query.current.snapshot.recordFilter).toBe("message");

    act(() => obsoleteIntent.setFilter("tool"));

    expect(query.current.snapshot.recordFilter).toBe("message");
  });
});
