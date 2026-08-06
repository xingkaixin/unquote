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
  scrollIntent: { kind: "path", recordId: "record-1", pathText: "$.payload.value" },
});

describe("reduceWorkspaceSelection", () => {
  it("creates an empty initial state", () => {
    expect(createInitialWorkspaceSelectionState()).toEqual({
      activeRecordId: null,
      detailSelection: null,
      selectedPath: null,
      scrollIntent: null,
    });
  });

  it("selects a path and issues a scroll intent for it", () => {
    const state = reduceWorkspaceSelection(createPopulatedState(), {
      type: "selectPath",
      selection: { recordId: "record-1", pathText: "$.payload.next", rawKey: "next" },
    });

    expect(state).toMatchObject({
      activeRecordId: "record-1",
      selectedPath: { recordId: "record-1", pathText: "$.payload.next", rawKey: "next" },
      scrollIntent: { kind: "path", recordId: "record-1", pathText: "$.payload.next" },
    });
  });

  it("activates the owning record when scrolling to a path in another record", () => {
    const state = reduceWorkspaceSelection(createPopulatedState(), {
      type: "scrollToPath",
      recordId: "record-2",
      pathText: "$.other",
    });

    // The workspace shows one record, so the scroll target has to become active
    // or the match never reaches the screen.
    expect(state.activeRecordId).toBe("record-2");
    expect(state.scrollIntent).toEqual({
      kind: "path",
      recordId: "record-2",
      pathText: "$.other",
    });
  });

  it("selects a record and issues a scroll intent for it", () => {
    const state = reduceWorkspaceSelection(createPopulatedState(), {
      type: "selectRecord",
      recordId: "record-2",
    });

    expect(state).toMatchObject({
      activeRecordId: "record-2",
      detailSelection: { kind: "record", recordId: "record-2" },
      scrollIntent: { kind: "record", recordId: "record-2" },
    });
  });

  it("selects agent detail and activates its record", () => {
    const selection = { kind: "conversation", id: "message-1", recordId: "record-1" } as const;
    const state = reduceWorkspaceSelection(createPopulatedState(), {
      type: "selectAgentDetail",
      selection,
    });

    expect(state.activeRecordId).toBe("record-1");
    expect(state.detailSelection).toBe(selection);
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

  it("clears the scroll intent", () => {
    const state = reduceWorkspaceSelection(createPopulatedState(), {
      type: "clearScrollIntent",
    });

    expect(state.scrollIntent).toBeNull();
    expect(state.selectedPath).not.toBeNull();
  });

  it("preserves state when the scroll intent is already clear", () => {
    const current = createInitialWorkspaceSelectionState();

    expect(reduceWorkspaceSelection(current, { type: "clearScrollIntent" })).toBe(current);
  });

  it("adopts the first record on append when no record is active", () => {
    const current = createInitialWorkspaceSelectionState();
    const state = reduceWorkspaceSelection(current, {
      type: "recordsAppended",
      firstRecordId: "record-1",
    });

    expect(state.activeRecordId).toBe("record-1");
  });

  it("leaves an already-active record untouched on append", () => {
    const current = createPopulatedState();
    const state = reduceWorkspaceSelection(current, {
      type: "recordsAppended",
      firstRecordId: "record-2",
    });

    expect(state).toBe(current);
  });

  it("preserves state on append when there is no first record", () => {
    const current = createInitialWorkspaceSelectionState();
    const state = reduceWorkspaceSelection(current, {
      type: "recordsAppended",
      firstRecordId: null,
    });

    expect(state).toBe(current);
  });
});
