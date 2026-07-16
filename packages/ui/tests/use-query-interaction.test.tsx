import { act, renderHook, waitFor } from "@testing-library/react";
import { parseInput } from "@unquote/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memorySearchDebounceMs, useQueryInteraction } from "../src/hooks/use-query-interaction";

const source = '{"payload":"needle"}\n{"payload":"needle"}';
const result = parseInput(source, { forcedFormat: "jsonl" });

const renderQuery = () =>
  renderHook(() =>
    useQueryInteraction({
      result,
      recordsVersion: 1,
      sourceText: source,
      sourceFile: null,
      forcedFormat: "jsonl",
      translateError: (reason) => reason,
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
    const { result: query } = renderQuery();

    act(() => query.current.intent.searchFromCommand("needle"));

    await waitFor(() => expect(query.current.snapshot.searchStatus).toBe("complete"));
    expect(query.current.snapshot).toMatchObject({
      mode: "search",
      recordFilter: "matches",
      matchCount: 2,
      currentMatchIndex: 0,
    });
    expect(query.current.snapshot.visibleRecords).toHaveLength(2);

    act(() => query.current.intent.nextResult());
    expect(query.current.snapshot.currentMatchIndex).toBe(1);
    expect(query.current.snapshot.navigationTarget).toMatchObject({
      kind: "search",
      matchIndex: 1,
    });
  });

  it("resolves path navigation and versions repeated navigation internally", () => {
    const { result: query } = renderQuery();

    act(() => query.current.intent.submitToolbarQuery("$.payload"));
    const firstTarget = query.current.snapshot.navigationTarget;
    expect(firstTarget).toMatchObject({
      kind: "path",
      recordId: "record-1",
      pathText: "$.payload",
    });

    act(() => query.current.intent.submitToolbarQuery("$.payload"));
    expect(query.current.snapshot.navigationTarget?.version).toBe((firstTarget?.version ?? 0) + 1);
  });

  it("keeps regex and jq mutually exclusive through option intents", () => {
    const { result: query } = renderQuery();

    act(() => query.current.intent.setOption("jq", true));
    expect(query.current.snapshot).toMatchObject({ searchJq: true, searchRegex: false });

    act(() => query.current.intent.setOption("regex", true));
    expect(query.current.snapshot).toMatchObject({ searchJq: false, searchRegex: true });
  });
});
