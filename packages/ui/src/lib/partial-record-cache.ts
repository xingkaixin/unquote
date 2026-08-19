import type { JsonlRecord } from "@unquote/core";
import { isRecordAppendFrom } from "./record-sequence";
import type { RecordAppend } from "./record-sequence";

export interface PartialRecordCache {
  records: readonly JsonlRecord[] | null;
  processedLength: number;
}

export interface PartialRecordCacheUpdate<T> {
  cache: PartialRecordCache;
  rebuilt: boolean;
  processed: { record: JsonlRecord; value: T }[];
}

export const createPartialRecordCache = (): PartialRecordCache => ({
  records: null,
  processedLength: 0,
});

export const updatePartialRecordCache = <T>(
  records: JsonlRecord[],
  state: PartialRecordCache,
  process: (record: JsonlRecord) => T,
  recordAppend: RecordAppend | null = null,
): PartialRecordCacheUpdate<T> => {
  const rebuilt =
    !isRecordAppendFrom(state.records, records, recordAppend) ||
    state.processedLength !== state.records?.length;
  const startIndex = rebuilt ? 0 : state.processedLength;
  const processed: { record: JsonlRecord; value: T }[] = [];

  for (let index = startIndex; index < records.length; index += 1) {
    const record = records[index]!;
    processed.push({ record, value: process(record) });
  }

  return {
    cache: {
      records,
      processedLength: records.length,
    },
    rebuilt,
    processed,
  };
};
