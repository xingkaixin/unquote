import type { JsonlRecord } from "@unquote/core";
import type { ExpandedStringifiedPathsByRecord } from "./record-expansion";
import type { RecordInsight } from "./record-insight";
import type { TreeRow } from "./tree";

export interface RecordViewPath {
  recordId: string;
  pathText: string;
}

export const narrowPathToRecord = (path: RecordViewPath | null, recordId: string): string | null =>
  path?.recordId === recordId ? path.pathText : null;

export interface RecordViewState {
  recordInsights: ReadonlyMap<string, RecordInsight>;
  resolveRecord: (record: JsonlRecord) => JsonlRecord;
  expandedStringifiedPathsByRecord: ExpandedStringifiedPathsByRecord;
  selectedPath: RecordViewPath | null;
}

export interface RecordViewActions {
  togglePath: (recordId: string, path: string) => void;
  copyRecord: (record: JsonlRecord) => void;
  copyRawLine: (record: JsonlRecord) => void;
  copyError: (record: JsonlRecord) => void;
  selectNode: (record: JsonlRecord, row: TreeRow) => void;
  requestFullRecord: (record: JsonlRecord) => void;
}

export interface RecordViewModel {
  state: RecordViewState;
  actions: RecordViewActions;
}
