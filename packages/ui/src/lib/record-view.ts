import type { JsonlRecord } from "@unquote/core";
import type { ExpandedStringifiedPathsByRecord } from "./record-expansion";
import type { RecordInsight } from "./record-insight";
import type { TreeRow } from "./tree";

export interface RecordViewPath {
  recordId: string;
  pathText: string;
}

export interface RecordViewState {
  recordInsights: ReadonlyMap<string, RecordInsight>;
  resolveRecord: (record: JsonlRecord) => JsonlRecord;
  expandedStringifiedPathsByRecord: ExpandedStringifiedPathsByRecord;
  selectedPath: RecordViewPath | null;
  focusedPath: RecordViewPath | null;
}

export interface RecordViewActions {
  togglePath: (recordId: string, path: string) => void;
  copyRecord: (record: JsonlRecord) => void;
  copyRawLine: (record: JsonlRecord) => void;
  copyError: (record: JsonlRecord) => void;
  selectNode: (record: JsonlRecord, row: TreeRow) => void;
  hydrateRecord: (record: JsonlRecord) => void;
  clearFocus: () => void;
}

export interface RecordViewModel {
  state: RecordViewState;
  actions: RecordViewActions;
}
