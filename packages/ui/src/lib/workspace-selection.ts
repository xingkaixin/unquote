import type { AgentDetailSelection } from "./agent-session";
import { issueScrollIntent, retainVisibleScrollIntent, type ScrollIntent } from "./scroll-intent";

export interface SelectedPath {
  recordId: string;
  pathText: string;
  rawKey: string;
}

export interface WorkspaceSelectionState {
  activeRecordId: string | null;
  detailSelection: AgentDetailSelection | null;
  selectedPath: SelectedPath | null;
  scrollIntent: ScrollIntent | null;
}

export const createInitialWorkspaceSelectionState = (): WorkspaceSelectionState => ({
  activeRecordId: null,
  detailSelection: null,
  selectedPath: null,
  scrollIntent: null,
});

export type WorkspaceSelectionAction =
  | { type: "scrollToPath"; recordId: string; pathText: string }
  | { type: "selectPath"; selection: SelectedPath }
  | { type: "selectRecord"; recordId: string }
  | { type: "selectAgentDetail"; selection: AgentDetailSelection }
  | { type: "recordsVisibilityChanged"; recordIds: readonly string[] }
  | { type: "recordsAppended"; firstRecordId: string | null }
  | { type: "clearScrollIntent" };

const retainVisibleRecordValue = <Value extends { recordId: string }>(
  value: Value | null,
  visibleRecordIds: ReadonlySet<string>,
) => (value && !visibleRecordIds.has(value.recordId) ? null : value);

export const reconcileWorkspaceSelection = (
  state: WorkspaceSelectionState,
  recordIds: readonly string[],
): WorkspaceSelectionState => {
  const visibleRecordIds = new Set(recordIds);
  const activeRecordId =
    state.activeRecordId && visibleRecordIds.has(state.activeRecordId)
      ? state.activeRecordId
      : (recordIds[0] ?? null);
  const detailSelection = retainVisibleRecordValue(state.detailSelection, visibleRecordIds);
  const selectedPath = retainVisibleRecordValue(state.selectedPath, visibleRecordIds);
  const scrollIntent = retainVisibleScrollIntent(state.scrollIntent, visibleRecordIds);

  if (
    activeRecordId === state.activeRecordId &&
    detailSelection === state.detailSelection &&
    selectedPath === state.selectedPath &&
    scrollIntent === state.scrollIntent
  ) {
    return state;
  }

  return {
    activeRecordId,
    detailSelection,
    selectedPath,
    scrollIntent,
  };
};

export const reduceWorkspaceSelection = (
  state: WorkspaceSelectionState,
  action: WorkspaceSelectionAction,
): WorkspaceSelectionState => {
  switch (action.type) {
    case "scrollToPath":
      // The workspace shows one record at a time, so a hit in another record
      // has to switch the displayed record before the scroll can land.
      return {
        ...state,
        activeRecordId: action.recordId,
        scrollIntent: issueScrollIntent({
          kind: "path",
          recordId: action.recordId,
          pathText: action.pathText,
        }),
      };

    case "selectPath":
      return {
        ...state,
        activeRecordId: action.selection.recordId,
        selectedPath: action.selection,
        scrollIntent: issueScrollIntent({
          kind: "path",
          recordId: action.selection.recordId,
          pathText: action.selection.pathText,
        }),
      };

    case "selectRecord":
      return {
        ...state,
        activeRecordId: action.recordId,
        detailSelection: { kind: "record", recordId: action.recordId },
        scrollIntent: issueScrollIntent({ kind: "record", recordId: action.recordId }),
      };

    case "selectAgentDetail":
      return {
        ...state,
        activeRecordId: action.selection.recordId,
        detailSelection: action.selection,
      };

    case "recordsVisibilityChanged":
      return reconcileWorkspaceSelection(state, action.recordIds);

    case "recordsAppended":
      // A pure append can never invalidate existing record-bound selection:
      // reconcileWorkspaceSelection only drops values absent from the visible
      // set, and appends only grow it. The only state an append can change is
      // an unset active record, which should adopt the (still) first record.
      return state.activeRecordId || !action.firstRecordId
        ? state
        : { ...state, activeRecordId: action.firstRecordId };

    case "clearScrollIntent":
      return state.scrollIntent ? { ...state, scrollIntent: null } : state;
  }
};
