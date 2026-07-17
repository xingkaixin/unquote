import { describe, expect, it } from "vitest";
import {
  createInitialWorkspaceSelectionState,
  reconcileWorkspaceSelection,
  reduceWorkspaceSelection,
  type WorkspaceSelectionState,
} from "../src/lib/workspace-selection";

const createPopulatedState = (): WorkspaceSelectionState => ({
  activeRecordId: "record-1",
  detailSelection: { kind: "event", id: "event-1", recordId: "record-1" },
  selectedPath: { recordId: "record-1", pathText: "$.payload.value", rawKey: "value" },
  focusedPath: { recordId: "record-1", pathText: "$.payload" },
  scrollIntent: { kind: "path", recordId: "record-1", pathText: "$.payload.value" },
});

describe("reduceWorkspaceSelection", () => {
  it("creates an empty initial state", () => {
    expect(createInitialWorkspaceSelectionState()).toEqual({
      activeRecordId: null,
      detailSelection: null,
      selectedPath: null,
      focusedPath: null,
      scrollIntent: null,
    });
  });

  it("selects a path and retains its ancestor focus", () => {
    const state = reduceWorkspaceSelection(createPopulatedState(), {
      type: "selectPath",
      selection: { recordId: "record-1", pathText: "$.payload.next", rawKey: "next" },
    });

    expect(state).toMatchObject({
      activeRecordId: "record-1",
      selectedPath: { recordId: "record-1", pathText: "$.payload.next", rawKey: "next" },
      focusedPath: { recordId: "record-1", pathText: "$.payload" },
      scrollIntent: { kind: "path", recordId: "record-1", pathText: "$.payload.next" },
    });
  });

  it("clears same-record focus outside the selected path", () => {
    const state = reduceWorkspaceSelection(createPopulatedState(), {
      type: "selectPath",
      selection: { recordId: "record-1", pathText: "$.other", rawKey: "other" },
    });

    expect(state.focusedPath).toBeNull();
  });

  it("clears unrelated focus when scrolling to a path", () => {
    const state = reduceWorkspaceSelection(createPopulatedState(), {
      type: "scrollToPath",
      recordId: "record-2",
      pathText: "$.other",
    });

    expect(state.focusedPath).toBeNull();
    expect(state.scrollIntent).toEqual({
      kind: "path",
      recordId: "record-2",
      pathText: "$.other",
    });
  });

  it("selects a record and clears focus from another record", () => {
    const state = reduceWorkspaceSelection(createPopulatedState(), {
      type: "selectRecord",
      recordId: "record-2",
    });

    expect(state).toMatchObject({
      activeRecordId: "record-2",
      detailSelection: { kind: "record", recordId: "record-2" },
      focusedPath: null,
      scrollIntent: { kind: "record", recordId: "record-2" },
    });
  });

  it("selects agent detail and retains focus for the same record", () => {
    const selection = { kind: "conversation", id: "message-1", recordId: "record-1" } as const;
    const state = reduceWorkspaceSelection(createPopulatedState(), {
      type: "selectAgentDetail",
      selection,
    });

    expect(state.activeRecordId).toBe("record-1");
    expect(state.detailSelection).toBe(selection);
    expect(state.focusedPath).toEqual({ recordId: "record-1", pathText: "$.payload" });
  });

  it("clears every hidden record-bound value in one visibility transition", () => {
    const state = reduceWorkspaceSelection(createPopulatedState(), {
      type: "recordsVisibilityChanged",
      recordIds: ["record-2"],
    });

    expect(state).toEqual({
      activeRecordId: "record-2",
      detailSelection: null,
      selectedPath: null,
      focusedPath: null,
      scrollIntent: null,
    });
  });

  it("reconciles navigation issued before records become hidden", () => {
    const navigated = reduceWorkspaceSelection(
      { ...createPopulatedState(), detailSelection: null },
      {
        type: "selectPath",
        selection: { recordId: "record-2", pathText: "$.payload", rawKey: "payload" },
      },
    );

    expect(reconcileWorkspaceSelection(navigated, ["record-1"])).toEqual({
      activeRecordId: "record-1",
      detailSelection: null,
      selectedPath: null,
      focusedPath: null,
      scrollIntent: null,
    });
  });

  it("returns the same state when every record-bound value remains visible", () => {
    const current = createPopulatedState();
    const state = reduceWorkspaceSelection(current, {
      type: "recordsVisibilityChanged",
      recordIds: ["record-1", "record-2"],
    });

    expect(state).toBe(current);
  });

  it("clears the active record when no records remain visible", () => {
    const state = reduceWorkspaceSelection(createPopulatedState(), {
      type: "recordsVisibilityChanged",
      recordIds: [],
    });

    expect(state.activeRecordId).toBeNull();
  });

  it("preserves the initial state when no visible records exist", () => {
    const current = createInitialWorkspaceSelectionState();
    const state = reduceWorkspaceSelection(current, {
      type: "recordsVisibilityChanged",
      recordIds: [],
    });

    expect(state).toBe(current);
  });

  it("resets transient selection while retaining the active record", () => {
    const state = reduceWorkspaceSelection(createPopulatedState(), {
      type: "resetTransientSelection",
    });

    expect(state).toEqual({
      activeRecordId: "record-1",
      detailSelection: null,
      selectedPath: null,
      focusedPath: null,
      scrollIntent: null,
    });
  });

  it("preserves state when transient selection is already reset", () => {
    const current = createInitialWorkspaceSelectionState();
    const state = reduceWorkspaceSelection(current, { type: "resetTransientSelection" });

    expect(state).toBe(current);
  });

  it("clears focus and scroll intents independently", () => {
    const withoutFocus = reduceWorkspaceSelection(createPopulatedState(), {
      type: "clearFocusedPath",
    });
    const withoutScroll = reduceWorkspaceSelection(withoutFocus, {
      type: "clearScrollIntent",
    });

    expect(withoutFocus.focusedPath).toBeNull();
    expect(withoutFocus.scrollIntent).not.toBeNull();
    expect(withoutScroll.scrollIntent).toBeNull();
  });

  it("preserves state when focus and scroll intents are already clear", () => {
    const current = createInitialWorkspaceSelectionState();
    const withoutFocus = reduceWorkspaceSelection(current, { type: "clearFocusedPath" });
    const withoutScroll = reduceWorkspaceSelection(current, { type: "clearScrollIntent" });

    expect(withoutFocus).toBe(current);
    expect(withoutScroll).toBe(current);
  });

  it("updates the active record only when the reported record changes", () => {
    const current = createPopulatedState();
    const unchanged = reduceWorkspaceSelection(current, {
      type: "activeRecordReported",
      recordId: "record-1",
    });
    const changed = reduceWorkspaceSelection(current, {
      type: "activeRecordReported",
      recordId: "record-2",
    });

    expect(unchanged).toBe(current);
    expect(changed.activeRecordId).toBe("record-2");
  });
});
