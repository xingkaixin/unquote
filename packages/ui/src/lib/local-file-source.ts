import { stringifyJsonNode } from "@unquote/core";
import type { JsonlRecord } from "@unquote/core";
import { readFileText, readJsonlLinesByNumber, streamJsonlRecords } from "./local-file-reader";
import { parseRecordLines } from "./record-parser";
import { createLocalFileSearch } from "./local-file-search";
import type { SearchOptions, SearchResultSet } from "./record-search";

export { readFileHead } from "./local-file-reader";
export type { SearchMatch, SearchOptions } from "./record-search";

export interface LocalFileAccess {
  readonly name: string;
  readonly size: number;
  getFile: () => File;
  readText: (onProgress: (progress: number) => void, signal?: AbortSignal) => Promise<string>;
  readRecords: (
    lineNumbers: ReadonlySet<number>,
    signal?: AbortSignal,
  ) => Promise<Map<number, JsonlRecord>>;
  resolveRecords: (records: JsonlRecord[], signal?: AbortSignal) => Promise<JsonlRecord[]>;
  streamRecords: (
    lineNumbers: ReadonlySet<number>,
    onRecord: (record: JsonlRecord) => void,
    signal?: AbortSignal,
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

const formatRecordText = (record: JsonlRecord) =>
  record.status === "failed" ? record.rawLine : stringifyJsonNode(record.node);

export const createLocalFileAccess = (file: File): LocalFileAccess => {
  const readRecords: LocalFileAccess["readRecords"] = async (lineNumbers, signal) => {
    signal?.throwIfAborted();
    const lines = await readJsonlLinesByNumber(file, new Set(lineNumbers), signal);
    return parseRecordLines(lines, signal);
  };
  return {
    name: file.name,
    size: file.size,
    getFile: () => file,
    readText: (onProgress, signal) => readFileText(file, onProgress, signal),
    readRecords,
    resolveRecords: async (records, signal) => {
      const resolved = await readRecords(
        new Set(records.map((record) => record.lineNumber)),
        signal,
      );
      return records.map((record) => resolved.get(record.lineNumber) ?? record);
    },
    streamRecords: (lineNumbers, onRecord, signal) =>
      streamJsonlRecords(file, lineNumbers, onRecord, signal),
    readRecordText: async (record, signal) => {
      const resolved = (await readRecords(new Set([record.lineNumber]), signal)).get(
        record.lineNumber,
      );
      if (resolved) {
        return formatRecordText(resolved);
      }
      return record.status === "failed" ? record.rawLine : record.summary;
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
