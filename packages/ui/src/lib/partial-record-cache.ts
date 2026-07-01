import type { JsonlRecord } from "@unquote/core";

// Shared incremental cache for per-record derived values (record-insight,
// file-overview). Reprocesses only the appended tail when the same records
// array grows; rebuilds (reusing unchanged record objects) when the array
// reference changes or shrinks.
export interface PartialRecordCache<T> {
  records: JsonlRecord[] | null;
  processedLength: number;
  entries: Map<string, { record: JsonlRecord; value: T }>;
}

export interface PartialRecordCacheUpdate<T> {
  // true when the cache was rebuilt from scratch (records ref changed or the
  // list shrank); callers reset any derived aggregate on rebuild.
  rebuilt: boolean;
  // Records processed this call, in order: the whole list on rebuild, only the
  // appended tail otherwise. Values are reused from cache when the record
  // object is unchanged.
  processed: { record: JsonlRecord; value: T }[];
}

export const createPartialRecordCache = <T>(): PartialRecordCache<T> => ({
  records: null,
  processedLength: 0,
  entries: new Map(),
});

export const updatePartialRecordCache = <T>(
  records: JsonlRecord[],
  state: PartialRecordCache<T>,
  process: (record: JsonlRecord) => T,
): PartialRecordCacheUpdate<T> => {
  const rebuilt = state.records !== records || state.processedLength > records.length;
  const startIndex = rebuilt ? 0 : state.processedLength;
  const processed: { record: JsonlRecord; value: T }[] = [];

  for (let index = startIndex; index < records.length; index += 1) {
    const record = records[index]!;
    const cached = state.entries.get(record.id);
    const value = cached?.record === record ? cached.value : process(record);
    state.entries.set(record.id, { record, value });
    processed.push({ record, value });
  }

  if (rebuilt) {
    const liveRecordIds = new Set(records.map((record) => record.id));
    for (const recordId of state.entries.keys()) {
      if (!liveRecordIds.has(recordId)) {
        state.entries.delete(recordId);
      }
    }
  }

  state.records = records;
  state.processedLength = records.length;
  return { rebuilt, processed };
};
