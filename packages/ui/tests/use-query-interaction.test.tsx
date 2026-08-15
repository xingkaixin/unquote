import { act, renderHook, waitFor } from "@testing-library/react";
import type { ParseResult } from "@unquote/core";
import { parseInput } from "@unquote/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  memorySearchDebounceMs,
  type QueryNavigationTarget,
  useQueryInteraction,
} from "../src/hooks/use-query-interaction";
import { createTextSourceRevision, projectSourceWork } from "../src/lib/published-source";
import type { SourceRevision } from "../src/lib/source-revision";

const source = '{"payload":"needle"}\n{"payload":"needle"}';
const result = parseInput(source, { forcedFormat: "jsonl" });

const sourceWork = (text: string, sourceRevision = 0) =>
  projectSourceWork(createTextSourceRevision(sourceRevision, text, "jsonl"));

const renderQuery = (onNavigate = vi.fn()) =>
  renderHook(() =>
    useQueryInteraction({
      source: sourceWork(source),
      resultRevision: 0,
      result,
      translateError: (reason) => reason,
      onNavigate,
    }),
  );

interface RevisionedQueryProps {
  sourceRevision: SourceRevision;
  parseResult: ParseResult;
  onNavigate: (target: QueryNavigationTarget) => void;
}

const renderRevisionedQuery = (initialProps: RevisionedQueryProps) =>
  renderHook(
    ({ sourceRevision, parseResult, onNavigate }: RevisionedQueryProps) =>
      useQueryInteraction({
        source: sourceWork(source, sourceRevision),
        resultRevision: sourceRevision,
        result: parseResult,
        translateError: (reason) => reason,
        onNavigate,
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
    const onNavigate = vi.fn();
    const { result: query } = renderQuery(onNavigate);

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
    onNavigate.mockClear();

    act(() => query.current.intent.nextResult());
    expect(query.current.snapshot.currentMatchIndex).toBe(1);
    expect(onNavigate).toHaveBeenLastCalledWith({
      sourceRevision: 0,
      kind: "search",
      recordId: "record-2",
      pathText: "$.payload",
    });
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
          source: sourceWork(""),
          resultRevision: 0,
          result: parseResult,
          translateError: (reason) => reason,
          onNavigate: vi.fn(),
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

  it("reissues repeated path navigation through its interface", () => {
    const onNavigate = vi.fn();
    const { result: query } = renderQuery(onNavigate);

    act(() => query.current.intent.submitToolbarQuery("$.payload"));
    expect(query.current.snapshot.activeSearchMatch).toBeNull();
    expect(onNavigate).toHaveBeenLastCalledWith({
      sourceRevision: 0,
      kind: "path",
      target: expect.objectContaining({
        recordId: "record-1",
        pathText: "$.payload",
      }),
    });

    act(() => query.current.intent.submitToolbarQuery("$.payload"));
    expect(onNavigate.mock.calls.map(([target]) => target.kind)).toEqual([
      "clear",
      "path",
      "clear",
      "path",
    ]);
  });

  it("stores lightweight path matches and resolves only the active navigation target", () => {
    const onNavigate = vi.fn();
    const { result: query } = renderQuery(onNavigate);

    act(() => query.current.intent.submitToolbarQuery("$.payload"));

    expect(query.current.snapshot.pathMatches).toEqual([
      { recordId: "record-1", pathText: "$.payload" },
      { recordId: "record-2", pathText: "$.payload" },
    ]);
    expect(onNavigate).toHaveBeenLastCalledWith({
      sourceRevision: 0,
      kind: "path",
      target: expect.objectContaining({
        recordId: "record-1",
        pathText: "$.payload",
        rawKey: "payload",
        node: expect.objectContaining({ value: "needle" }),
      }),
    });

    onNavigate.mockClear();
    act(() => query.current.intent.nextResult());

    expect(query.current.snapshot.currentPathMatchIndex).toBe(1);
    expect(onNavigate).toHaveBeenLastCalledWith({
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

  it("pauses automatic navigation while restoring all Records for an endpoint", async () => {
    const firstNavigation = vi.fn<(target: QueryNavigationTarget) => void>();
    const replacementNavigation = vi.fn<(target: QueryNavigationTarget) => void>();
    const { result: query, rerender } = renderRevisionedQuery({
      sourceRevision: 0,
      parseResult: result,
      onNavigate: firstNavigation,
    });

    act(() => query.current.intent.searchFromCommand("needle"));
    await waitFor(() => expect(query.current.snapshot.searchStatus).toBe("complete"));
    firstNavigation.mockClear();

    act(() => query.current.intent.setFilter("all", { preserveActiveRecord: true }));
    expect(query.current.snapshot).toMatchObject({
      recordFilter: "all",
      searchQuery: "needle",
    });

    rerender({
      sourceRevision: 0,
      parseResult: parseInput(source, { forcedFormat: "jsonl" }),
      onNavigate: replacementNavigation,
    });
    await act(async () => undefined);

    expect(firstNavigation).toHaveBeenLastCalledWith({ sourceRevision: 0, kind: "clear" });
    expect(firstNavigation).toHaveBeenCalledTimes(1);
    expect(replacementNavigation).not.toHaveBeenCalled();

    act(() => query.current.intent.nextResult());
    await waitFor(() =>
      expect(replacementNavigation).toHaveBeenLastCalledWith({
        sourceRevision: 0,
        kind: "search",
        recordId: "record-2",
        pathText: "$.payload",
      }),
    );
  });

  it("does not carry a paused automatic navigation into a new Source Revision", async () => {
    const navigation = vi.fn<(target: QueryNavigationTarget) => void>();
    const { result: query, rerender } = renderRevisionedQuery({
      sourceRevision: 0,
      parseResult: result,
      onNavigate: navigation,
    });

    act(() => query.current.intent.searchFromCommand("needle"));
    await waitFor(() => expect(query.current.snapshot.searchStatus).toBe("complete"));
    act(() => query.current.intent.setFilter("all", { preserveActiveRecord: true }));
    navigation.mockClear();

    rerender({ sourceRevision: 1, parseResult: result, onNavigate: navigation });
    act(() => query.current.intent.searchFromCommand("needle"));

    await waitFor(() =>
      expect(navigation).toHaveBeenLastCalledWith({
        sourceRevision: 1,
        kind: "search",
        recordId: "record-1",
        pathText: "$.payload",
      }),
    );
  });
});
