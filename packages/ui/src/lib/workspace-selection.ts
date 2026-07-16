import { isPathWithin } from "./path-codec";

export interface PathScrollTarget {
  recordId: string;
  pathText: string;
  requestId: number;
}

export interface SelectedPath {
  recordId: string;
  pathText: string;
  rawKey: string;
}

export interface FocusedPath {
  recordId: string;
  pathText: string;
}

export interface RecordScrollTarget {
  recordId: string;
  requestId: number;
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
  scrollTarget: PathScrollTarget | null;
  recordScrollTarget: RecordScrollTarget | null;
}

export const createInitialWorkspaceSelectionState = (): WorkspaceSelectionState => ({
  activeRecordId: null,
  detailSelection: null,
  selectedPath: null,
  focusedPath: null,
  scrollTarget: null,
  recordScrollTarget: null,
});

export type WorkspaceSelectionAction =
  | { type: "scrollToPath"; recordId: string; pathText: string; requestId: number }
  | { type: "selectPath"; selection: SelectedPath; requestId: number }
  | { type: "selectRecord"; recordId: string; requestId: number }
  | { type: "selectAgentDetail"; selection: AgentDetailSelection }
  | { type: "resetTransientSelection" }
  | { type: "recordsVisibilityChanged"; recordIds: readonly string[] }
  | { type: "clearFocusedPath" }
  | { type: "clearPathScrollTarget" }
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

export const reduceWorkspaceSelection = (
  state: WorkspaceSelectionState,
  action: WorkspaceSelectionAction,
): WorkspaceSelectionState => {
  switch (action.type) {
    case "scrollToPath":
      return {
        ...state,
        focusedPath: retainFocusForPath(state.focusedPath, action.recordId, action.pathText),
        scrollTarget: {
          recordId: action.recordId,
          pathText: action.pathText,
          requestId: action.requestId,
        },
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
        scrollTarget: {
          recordId: action.selection.recordId,
          pathText: action.selection.pathText,
          requestId: action.requestId,
        },
      };

    case "selectRecord":
      return {
        ...state,
        activeRecordId: action.recordId,
        detailSelection: { kind: "record", recordId: action.recordId },
        focusedPath: retainFocusForRecord(state.focusedPath, action.recordId),
        recordScrollTarget: { recordId: action.recordId, requestId: action.requestId },
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
        !state.scrollTarget &&
        !state.recordScrollTarget
      ) {
        return state;
      }
      return {
        ...state,
        detailSelection: null,
        selectedPath: null,
        focusedPath: null,
        scrollTarget: null,
        recordScrollTarget: null,
      };

    case "recordsVisibilityChanged": {
      const visibleRecordIds = new Set(action.recordIds);
      const activeRecordId =
        state.activeRecordId && visibleRecordIds.has(state.activeRecordId)
          ? state.activeRecordId
          : (action.recordIds[0] ?? null);
      const detailSelection = retainVisibleRecordValue(state.detailSelection, visibleRecordIds);
      const selectedPath = retainVisibleRecordValue(state.selectedPath, visibleRecordIds);
      const focusedPath = retainVisibleRecordValue(state.focusedPath, visibleRecordIds);
      const scrollTarget = retainVisibleRecordValue(state.scrollTarget, visibleRecordIds);
      const recordScrollTarget = retainVisibleRecordValue(
        state.recordScrollTarget,
        visibleRecordIds,
      );

      if (
        activeRecordId === state.activeRecordId &&
        detailSelection === state.detailSelection &&
        selectedPath === state.selectedPath &&
        focusedPath === state.focusedPath &&
        scrollTarget === state.scrollTarget &&
        recordScrollTarget === state.recordScrollTarget
      ) {
        return state;
      }

      return {
        activeRecordId,
        detailSelection,
        selectedPath,
        focusedPath,
        scrollTarget,
        recordScrollTarget,
      };
    }

    case "clearFocusedPath":
      return state.focusedPath ? { ...state, focusedPath: null } : state;

    case "clearPathScrollTarget":
      return state.scrollTarget ? { ...state, scrollTarget: null } : state;

    case "activeRecordReported":
      return state.activeRecordId === action.recordId
        ? state
        : { ...state, activeRecordId: action.recordId };
  }
};
