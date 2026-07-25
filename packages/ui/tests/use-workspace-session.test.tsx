import { act, renderHook } from "@testing-library/react";
import { parseInput } from "@unquote/core";
import { describe, expect, it } from "vitest";
import { useWorkspaceSession } from "../src/hooks/use-workspace-session";

describe("useWorkspaceSession", () => {
  it("coordinates path selection, expansion, focus, and reset through intents", () => {
    const { result } = renderHook(() => useWorkspaceSession());

    act(() => {
      result.current.selectPath(
        { recordId: "record-2", pathText: "$.payload.nested", rawKey: "nested" },
        ["$.payload"],
      );
    });

    expect(result.current.state).toMatchObject({
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
    });
    expect(result.current.state.expandedPaths.get("record-2")).toEqual(new Set(["$.payload"]));

    act(() => result.current.reset());

    expect(result.current.state.selectedPath).toBeNull();
    expect(result.current.state.scrollIntent).toBeNull();
    expect(result.current.state.expandedPaths).toEqual(new Map());
  });

  it("reconciles navigation state when visible records change", () => {
    const records = parseInput('{"value":1}\n{"value":2}', { forcedFormat: "jsonl" }).records;
    const { result } = renderHook(() => useWorkspaceSession());

    act(() => {
      result.current.selectRecord(records[0]!);
      result.current.selectPath({
        recordId: records[0]!.id,
        pathText: "$.value",
        rawKey: "value",
      });
    });
    act(() => result.current.reconcileVisibleRecords([records[1]!]));

    expect(result.current.state).toMatchObject({
      activeRecordId: records[1]!.id,
      detailSelection: null,
      selectedPath: null,
      focusedPath: null,
      scrollIntent: null,
    });
  });

  it("keeps selection references stable when visible records only append", () => {
    const records = parseInput('{"value":1}\n{"value":2}\n{"value":3}', {
      forcedFormat: "jsonl",
    }).records;
    const { result } = renderHook(() => useWorkspaceSession());

    act(() => result.current.reconcileVisibleRecords([records[0]!, records[1]!]));
    act(() => {
      result.current.selectPath({
        recordId: records[1]!.id,
        pathText: "$.value",
        rawKey: "value",
      });
    });

    const stateBeforeAppend = result.current.state;
    act(() => result.current.reconcileVisibleRecords([records[0]!, records[1]!, records[2]!]));

    expect(result.current.state.activeRecordId).toBe(stateBeforeAppend.activeRecordId);
    expect(result.current.state.selectedPath).toBe(stateBeforeAppend.selectedPath);
    expect(result.current.state.detailSelection).toBe(stateBeforeAppend.detailSelection);
    expect(result.current.state.focusedPath).toBe(stateBeforeAppend.focusedPath);
    expect(result.current.state.scrollIntent).toBe(stateBeforeAppend.scrollIntent);
  });

  it("expands every level of nested stringified JSON in one pass", () => {
    // Three levels: $.payload holds JSON holding JSON. A single
    // collectStringifiedPaths call only reaches the outermost one.
    const deepest = JSON.stringify({ deep: 1 });
    const middle = JSON.stringify({ inner: deepest });
    const records = parseInput(JSON.stringify({ payload: middle }), {
      forcedFormat: "jsonl",
    }).records;
    const { result } = renderHook(() => useWorkspaceSession());

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
    const { result } = renderHook(() => useWorkspaceSession());
    const staleSeed = new Map([[records[0]!.id, new Set(["$.gone"])]]);

    act(() => result.current.expandAll(records, staleSeed));

    expect([...result.current.state.expandedPaths.get(records[0]!.id)!]).toEqual(["$.payload"]);
  });

  it("reconciles selection when visible records are replaced rather than appended", () => {
    const records = parseInput('{"value":1}\n{"value":2}\n{"value":3}', {
      forcedFormat: "jsonl",
    }).records;
    const { result } = renderHook(() => useWorkspaceSession());

    act(() => result.current.reconcileVisibleRecords([records[0]!, records[1]!]));
    act(() => {
      result.current.selectPath({
        recordId: records[1]!.id,
        pathText: "$.value",
        rawKey: "value",
      });
    });

    act(() => result.current.reconcileVisibleRecords([records[2]!]));

    expect(result.current.state).toMatchObject({
      activeRecordId: records[2]!.id,
      detailSelection: null,
      selectedPath: null,
      focusedPath: null,
      scrollIntent: null,
    });
  });
});
