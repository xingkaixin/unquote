import { stringifyJsonNode } from "@unquote/core";
import type { JsonlRecord } from "@unquote/core";
import { readFileText, readJsonlLinesByNumber, streamJsonlLineBatches } from "./local-file-reader";
import { createRecordParser } from "./record-parser";
import { createLocalFileSearch } from "./local-file-search";
import type { SearchOptions, SearchResultSet } from "./record-search";

export { readFileHead } from "./local-file-reader";

export type { SearchMatch, SearchOptions } from "./record-search";

export interface LocalFileAccess {
  readonly name: string;
  readonly size: number;
  dispose: () => void;
  getFile: () => File;
  readText: (onProgress: (progress: number) => void, signal?: AbortSignal) => Promise<string>;
  readRecords: (
    lineNumbers: ReadonlySet<number>,
    signal?: AbortSignal,
  ) => Promise<Map<number, JsonlRecord>>;
  resolveRecords: (
    records: JsonlRecord[],
    signal?: AbortSignal,
    maxBytes?: number,
  ) => Promise<JsonlRecord[]>;
  streamRecords: (
    lineNumbers: ReadonlySet<number>,
    onRecord: (record: JsonlRecord) => void | Promise<void>,
    signal?: AbortSignal,
    maxBytes?: number,
  ) => Promise<void>;
  readRecordText: (record: JsonlRecord, signal?: AbortSignal) => Promise<string>;
  readRecordTextByLine: (lineNumber: number, signal?: AbortSignal) => Promise<string>;
  search: (
    query: string,
    options: SearchOptions,
    signal: AbortSignal,
    windowIndexes?: ArrayLike<number>,
  ) => Promise<SearchResultSet | null>;
}

const streamBatchMaxLines = 32;

const streamBatchMaxBytes = 256 * 1024;

const formatRecordText = (record: JsonlRecord) =>
  record.status === "failed" ? record.rawLine : stringifyJsonNode(record.node);

export const createLocalFileAccess = (file: File): LocalFileAccess => {
  const recordParser = createRecordParser();
  const readRecords: LocalFileAccess["readRecords"] = async (lineNumbers, signal) => {
    signal?.throwIfAborted();
    const lines = await readJsonlLinesByNumber(file, new Set(lineNumbers), signal);
    return recordParser.parse(lines, signal);
  };
  return {
    name: file.name,
    size: file.size,
    dispose: () => recordParser.dispose(),
    getFile: () => file,
    readText: (onProgress, signal) => readFileText(file, onProgress, signal),
    readRecords,
    resolveRecords: async (records, signal, maxBytes) => {
      signal?.throwIfAborted();
      const incomplete = records.filter(
        (record) =>
          record.status === "preview" || (record.status === "failed" && record.rawLineTruncated),
      );
      if (!incomplete.length) return records;
      const lines = await readJsonlLinesByNumber(
        file,
        new Set(incomplete.map((record) => record.lineNumber)),
        signal,
        maxBytes,
      );
      const resolved = await recordParser.parse(lines, signal);
      return records.map((record) => {
        if (record.status !== "preview" && !(record.status === "failed" && record.rawLineTruncated))
          return record;
        const full = resolved.get(record.lineNumber);
        if (!full) {
          throw new Error(`Record line ${record.lineNumber} was not found`);
        }
        return full;
      });
    },
    streamRecords: async (lineNumbers, onRecord, signal, maxBytes) => {
      signal?.throwIfAborted();
      if (lineNumbers.size === 0) return;
      await streamJsonlLineBatches(
        file,
        lineNumbers,
        async (batch) => {
          signal?.throwIfAborted();
          const records = await recordParser.parse(batch, signal);
          signal?.throwIfAborted();
          for (const lineNumber of batch.keys()) {
            const record = records.get(lineNumber);
            if (!record) throw new Error(`Record line ${lineNumber} was not found`);
            await onRecord(record);
            signal?.throwIfAborted();
          }
        },
        {
          signal,
          maxBytes,
          batchMaxLines: streamBatchMaxLines,
          batchMaxBytes: streamBatchMaxBytes,
        },
      );
      signal?.throwIfAborted();
    },
    readRecordText: async (record, signal) => {
      const resolved = (await readRecords(new Set([record.lineNumber]), signal)).get(
        record.lineNumber,
      );
      if (!resolved) {
        throw new Error(`Record line ${record.lineNumber} was not found`);
      }
      return formatRecordText(resolved);
    },
    readRecordTextByLine: async (lineNumber, signal) => {
      const line = (await readJsonlLinesByNumber(file, new Set([lineNumber]), signal)).get(
        lineNumber,
      );
      if (line === undefined) {
        throw new Error(`Record line ${lineNumber} was not found`);
      }
      return line;
    },
    search: createLocalFileSearch(file),
  };
};
