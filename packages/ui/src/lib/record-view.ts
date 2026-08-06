import type { JsonlRecord } from "@unquote/core";
import type { TreeRow } from "./tree";

export interface RecordViewPath {
  recordId: string;
  pathText: string;
}

export const narrowPathToRecord = (path: RecordViewPath | null, recordId: string): string | null =>
  path?.recordId === recordId ? path.pathText : null;

export interface RecordViewActions {
  togglePath: (recordId: string, path: string) => void;
  copyRecord: (record: JsonlRecord) => void;
  copyRawLine: (record: JsonlRecord) => void;
  copyError: (record: JsonlRecord) => void;
  selectNode: (record: JsonlRecord, row: TreeRow) => void;
  requestFullRecord: (record: JsonlRecord) => void;
}
