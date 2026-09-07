import type { JsonlRecord } from "@unquote/core";

export const fullRecordCacheBytesLimit = 32 * 1024 * 1024;
const fullRecordCacheCountLimit = 500;

interface CachedRecord {
  record: JsonlRecord;
  bytes: number;
}

export type FullRecordCacheEntries = ReadonlyMap<number, CachedRecord>;

// Estimate the retained tree, including rawString and truncated lossless values.
// Object/property allowances and UTF-16 strings deliberately overcount sharing;
// this is a cache admission budget, not a measurement of the engine's heap.
const estimateRecordBytes = (record: JsonlRecord) => {
  let bytes = 0;
  const pending: unknown[] = [record];
  while (pending.length) {
    const value = pending.pop();
    if (typeof value === "string") {
      bytes += 24 + value.length * 2;
    } else if (value && typeof value === "object") {
      bytes += 64;
      for (const key in value) {
        if (!Object.hasOwn(value, key)) continue;
        bytes += 32 + key.length * 2;
        if (bytes > fullRecordCacheBytesLimit) return fullRecordCacheBytesLimit + 1;
        pending.push((value as Record<string, unknown>)[key]);
      }
    } else {
      bytes += 8;
    }
    if (bytes > fullRecordCacheBytesLimit) return fullRecordCacheBytesLimit + 1;
  }
  return bytes;
};

export const cacheFullRecords = (
  current: FullRecordCacheEntries,
  records: Iterable<JsonlRecord>,
): FullRecordCacheEntries => {
  let next: Map<number, CachedRecord> | undefined;
  let bytes = 0;
  for (const entry of current.values()) bytes += entry.bytes;
  for (const record of records) {
    if ((next ?? current).has(record.lineNumber)) continue;
    next ??= new Map(current);
    const entry = { record, bytes: estimateRecordBytes(record) };
    next.set(record.lineNumber, entry);
    bytes += entry.bytes;
    // Keep one oversized record usable until another record is requested.
    while (
      next.size > 1 &&
      (next.size > fullRecordCacheCountLimit || bytes > fullRecordCacheBytesLimit)
    ) {
      const oldest = next.entries().next().value!;
      next.delete(oldest[0]);
      bytes -= oldest[1].bytes;
    }
  }
  return next ?? current;
};
