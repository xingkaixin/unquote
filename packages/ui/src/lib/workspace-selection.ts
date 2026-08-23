import type { AgentDetailSelection } from "./agent-session";
import type { RecordAppend } from "./record-sequence";
import {
  issueScrollIntent,
  retainVisibleScrollIntent,
  type ScrollIntent,
  type VisibleRecordIds,
} from "./scroll-intent";

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

export interface WorkspaceSelectionVisibility {
  firstRecordId: string | null;
  recordIds: VisibleRecordIds;
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
  | { type: "openAgentRecord"; selection: AgentDetailSelection; recordId: string }
  | { type: "recordsVisibilityChanged"; visibility: WorkspaceSelectionVisibility }
  | { type: "recordsAppended"; firstRecordId: string | null }
  | { type: "clearScrollIntent" };

const retainVisibleRecordValue = <Value extends { recordId: string }>(
  value: Value | null,
  visibleRecordIds: VisibleRecordIds,
) => (value && !visibleRecordIds.has(value.recordId) ? null : value);

const retainVisibleDetailSelection = (
  selection: AgentDetailSelection | null,
  visibleRecordIds: VisibleRecordIds,
) =>
  selection?.kind === "trajectory"
    ? selection
    : retainVisibleRecordValue(selection, visibleRecordIds);

export const reconcileWorkspaceSelection = (
  state: WorkspaceSelectionState,
  visibility: WorkspaceSelectionVisibility,
): WorkspaceSelectionState => {
  const activeRecordId =
    state.activeRecordId && visibility.recordIds.has(state.activeRecordId)
      ? state.activeRecordId
      : visibility.firstRecordId;
  const detailSelection = retainVisibleDetailSelection(state.detailSelection, visibility.recordIds);
  const selectedPath = retainVisibleRecordValue(state.selectedPath, visibility.recordIds);
  const scrollIntent = retainVisibleScrollIntent(state.scrollIntent, visibility.recordIds);

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

export const projectWorkspaceSelection = (
  selection: WorkspaceSelectionState,
  visibility: WorkspaceSelectionVisibility,
  recordAppend: RecordAppend | null,
) =>
  recordAppend
    ? reduceWorkspaceSelection(selection, {
        type: "recordsAppended",
        firstRecordId: visibility.firstRecordId,
      })
    : reconcileWorkspaceSelection(selection, visibility);

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

    case "openAgentRecord":
      return {
        ...state,
        activeRecordId: action.recordId,
        detailSelection: action.selection,
        scrollIntent: issueScrollIntent({ kind: "record", recordId: action.recordId }),
      };

    case "recordsVisibilityChanged":
      return reconcileWorkspaceSelection(state, action.visibility);

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
