import type { JsonlRecord } from "@unquote/core";

export interface RecordAppend {
  previousRecords: readonly JsonlRecord[];
}

export const isRecordAppendFrom = (
  previousRecords: readonly JsonlRecord[] | null,
  records: readonly JsonlRecord[],
  append: RecordAppend | null | undefined,
) =>
  previousRecords !== null &&
  append?.previousRecords === previousRecords &&
  previousRecords.length <= records.length;
