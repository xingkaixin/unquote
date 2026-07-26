import { act, renderHook, waitFor } from "@testing-library/react";
import { parseInput } from "@unquote/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memorySearchDebounceMs, useQueryInteraction } from "../src/hooks/use-query-interaction";

const source = '{"payload":"needle"}\n{"payload":"needle"}';
const result = parseInput(source, { forcedFormat: "jsonl" });

const renderQuery = (onNavigate = vi.fn()) =>
  renderHook(() =>
    useQueryInteraction({
      sourceRevision: 0,
      resultRevision: 0,
      result,
      sourceText: source,
      sourceAccess: null,
      forcedFormat: "jsonl",
      translateError: (reason) => reason,
      onNavigate,
    }),
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
          sourceRevision: 0,
          resultRevision: 0,
          result: parseResult,
          sourceText: "",
          sourceAccess: null,
          forcedFormat: "jsonl",
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
});
