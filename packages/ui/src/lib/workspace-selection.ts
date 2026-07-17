import { isPathWithin } from "./path-codec";
import { issueScrollIntent, retainVisibleScrollIntent, type ScrollIntent } from "./scroll-intent";

export interface SelectedPath {
  recordId: string;
  pathText: string;
  rawKey: string;
}

export interface FocusedPath {
  recordId: string;
  pathText: string;
}

export type AgentDetailSelection =
  | { kind: "record"; recordId: string }
  | { kind: "event"; id: string; recordId: string }
  | { kind: "conversation"; id: string; recordId: string };

export interface WorkspaceSelectionState {
  activeRecordId: string | null;
  detailSelection: AgentDetailSelection | null;
  selectedPath: SelectedPath | null;
  focusedPath: FocusedPath | null;
  scrollIntent: ScrollIntent | null;
}

export const createInitialWorkspaceSelectionState = (): WorkspaceSelectionState => ({
  activeRecordId: null,
  detailSelection: null,
  selectedPath: null,
  focusedPath: null,
  scrollIntent: null,
});

export type WorkspaceSelectionAction =
  | { type: "scrollToPath"; recordId: string; pathText: string }
  | { type: "selectPath"; selection: SelectedPath }
  | { type: "selectRecord"; recordId: string }
  | { type: "selectAgentDetail"; selection: AgentDetailSelection }
  | { type: "resetTransientSelection" }
  | { type: "recordsVisibilityChanged"; recordIds: readonly string[] }
  | { type: "clearFocusedPath" }
  | { type: "clearScrollIntent" }
  | { type: "activeRecordReported"; recordId: string };

const retainFocusForPath = (focusedPath: FocusedPath | null, recordId: string, pathText: string) =>
  focusedPath &&
  (focusedPath.recordId !== recordId || !isPathWithin(pathText, focusedPath.pathText))
    ? null
    : focusedPath;

const retainFocusForRecord = (focusedPath: FocusedPath | null, recordId: string) =>
  focusedPath?.recordId === recordId ? focusedPath : null;

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
  const focusedPath = retainVisibleRecordValue(state.focusedPath, visibleRecordIds);
  const scrollIntent = retainVisibleScrollIntent(state.scrollIntent, visibleRecordIds);

  if (
    activeRecordId === state.activeRecordId &&
    detailSelection === state.detailSelection &&
    selectedPath === state.selectedPath &&
    focusedPath === state.focusedPath &&
    scrollIntent === state.scrollIntent
  ) {
    return state;
  }

  return {
    activeRecordId,
    detailSelection,
    selectedPath,
    focusedPath,
    scrollIntent,
  };
};

export const reduceWorkspaceSelection = (
  state: WorkspaceSelectionState,
  action: WorkspaceSelectionAction,
): WorkspaceSelectionState => {
  switch (action.type) {
    case "scrollToPath":
      return {
        ...state,
        focusedPath: retainFocusForPath(state.focusedPath, action.recordId, action.pathText),
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
        focusedPath: retainFocusForPath(
          state.focusedPath,
          action.selection.recordId,
          action.selection.pathText,
        ),
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
        focusedPath: retainFocusForRecord(state.focusedPath, action.recordId),
        scrollIntent: issueScrollIntent({ kind: "record", recordId: action.recordId }),
      };

    case "selectAgentDetail":
      return {
        ...state,
        activeRecordId: action.selection.recordId,
        detailSelection: action.selection,
        focusedPath: retainFocusForRecord(state.focusedPath, action.selection.recordId),
      };

    case "resetTransientSelection":
      if (
        !state.detailSelection &&
        !state.selectedPath &&
        !state.focusedPath &&
        !state.scrollIntent
      ) {
        return state;
      }
      return {
        ...state,
        detailSelection: null,
        selectedPath: null,
        focusedPath: null,
        scrollIntent: null,
      };

    case "recordsVisibilityChanged":
      return reconcileWorkspaceSelection(state, action.recordIds);

    case "clearFocusedPath":
      return state.focusedPath ? { ...state, focusedPath: null } : state;

    case "clearScrollIntent":
      return state.scrollIntent ? { ...state, scrollIntent: null } : state;

    case "activeRecordReported":
      return state.activeRecordId === action.recordId
        ? state
        : { ...state, activeRecordId: action.recordId };
  }
};
