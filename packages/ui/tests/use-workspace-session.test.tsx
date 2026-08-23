import { act, renderHook } from "@testing-library/react";
import { parseInput } from "@unquote/core";
import { describe, expect, it } from "vitest";
import { useWorkspaceSession } from "../src/hooks/use-workspace-session";

describe("useWorkspaceSession", () => {
  it("keeps a trajectory selection while opening an endpoint Record", () => {
    const { result, rerender } = renderHook(
      ({ sourceRevision }) => useWorkspaceSession(sourceRevision),
      { initialProps: { sourceRevision: 0 } },
    );
    const selection = {
      kind: "trajectory",
      id: "tool-call:evidence-0",
      recordId: "record-call",
    } as const;
    const openAgentRecordFromRevisionZero = result.current.openAgentRecord;

    act(() => openAgentRecordFromRevisionZero(selection, "record-completion"));

    expect(result.current.state.selection.activeRecordId).toBe("record-completion");
    expect(result.current.state.selection.scrollIntent).toEqual({
      kind: "record",
      recordId: "record-completion",
    });
    expect(result.current.state.selection.detailSelection).toBe(selection);

    rerender({ sourceRevision: 1 });

    expect(result.current.state).toMatchObject({
      sourceRevision: 1,
      selection: {
        activeRecordId: null,
        detailSelection: null,
        scrollIntent: null,
      },
    });

    act(() => openAgentRecordFromRevisionZero(selection, "record-result"));

    expect(result.current.state.selection.activeRecordId).toBeNull();
    expect(result.current.state.selection.detailSelection).toBeNull();
    expect(result.current.state.selection.scrollIntent).toBeNull();
  });

  it("invalidates selection and expansion when the Source Revision changes", () => {
    const { result, rerender } = renderHook(
      ({ sourceRevision }) => useWorkspaceSession(sourceRevision),
      { initialProps: { sourceRevision: 0 } },
    );

    act(() => {
      result.current.selectPath(
        { recordId: "record-2", pathText: "$.payload.nested", rawKey: "nested" },
        ["$.payload"],
      );
    });

    expect(result.current.state).toMatchObject({
      selection: {
        activeRecordId: "record-2",
        selectedPath: {
          recordId: "record-2",
          pathText: "$.payload.nested",
          rawKey: "nested",
        },
        scrollIntent: {
          kind: "path",
          recordId: "record-2",
          pathText: "$.payload.nested",
        },
      },
    });
    expect(result.current.state.expandedPaths.get("record-2")).toEqual(new Set(["$.payload"]));

    rerender({ sourceRevision: 1 });

    expect(result.current.state).toMatchObject({
      sourceRevision: 1,
      selection: {
        activeRecordId: null,
        selectedPath: null,
        scrollIntent: null,
      },
    });
    expect(result.current.state.expandedPaths).toEqual(new Map());
  });

  it("ignores navigation from an obsolete Source Revision", () => {
    const { result, rerender } = renderHook(
      ({ sourceRevision }) => useWorkspaceSession(sourceRevision),
      { initialProps: { sourceRevision: 0 } },
    );

    act(() => {
      result.current.navigate({
        sourceRevision: 0,
        kind: "search",
        recordId: "record-1",
        pathText: "$.value",
      });
    });
    expect(result.current.state.selection.scrollIntent).toMatchObject({
      recordId: "record-1",
      pathText: "$.value",
    });

    const navigateFromRevisionZero = result.current.navigate;
    rerender({ sourceRevision: 1 });
    act(() => {
      result.current.navigate({
        sourceRevision: 0,
        kind: "search",
        recordId: "record-2",
        pathText: "$.stale",
      });
      navigateFromRevisionZero({
        sourceRevision: 0,
        kind: "search",
        recordId: "record-3",
        pathText: "$.alsoStale",
      });
    });

    expect(result.current.state.selection.scrollIntent).toBeNull();

    act(() => {
      result.current.navigate({
        sourceRevision: 1,
        kind: "search",
        recordId: "record-4",
        pathText: "$.current",
      });
    });
    expect(result.current.state.selection.scrollIntent).toMatchObject({
      recordId: "record-4",
      pathText: "$.current",
    });
  });

  it("seeds sample expansions for the revision returned by the source publisher", () => {
    const { result, rerender } = renderHook(
      ({ sourceRevision }) => useWorkspaceSession(sourceRevision),
      { initialProps: { sourceRevision: 0 } },
    );

    act(() => {
      result.current.setSampleExpansions(2, [{ recordId: "record-1", paths: ["$.payload"] }]);
    });
    rerender({ sourceRevision: 2 });

    expect(result.current.state.expandedPaths.get("record-1")).toEqual(new Set(["$.payload"]));
  });

  it("expands every level of nested stringified JSON in one pass", () => {
    // Three levels: $.payload holds JSON holding JSON. A single
    // collectStringifiedPaths call only reaches the outermost one.
    const deepest = JSON.stringify({ deep: 1 });
    const middle = JSON.stringify({ inner: deepest });
    const records = parseInput(JSON.stringify({ payload: middle }), {
      forcedFormat: "jsonl",
    }).records;
    const { result } = renderHook(() => useWorkspaceSession(0));

    act(() => result.current.expandAll(records, new Map()));

    expect([...result.current.state.expandedPaths.get(records[0]!.id)!].sort()).toEqual([
      "$.payload",
      "$.payload.inner",
    ]);
  });

  it("drops seeded expansion paths that the record no longer contains", () => {
    const records = parseInput(JSON.stringify({ payload: JSON.stringify({ a: 1 }) }), {
      forcedFormat: "jsonl",
    }).records;
    const { result } = renderHook(() => useWorkspaceSession(0));
    const staleSeed = new Map([[records[0]!.id, new Set(["$.gone"])]]);

    act(() => result.current.expandAll(records, staleSeed));

    expect([...result.current.state.expandedPaths.get(records[0]!.id)!]).toEqual(["$.payload"]);
  });
});
