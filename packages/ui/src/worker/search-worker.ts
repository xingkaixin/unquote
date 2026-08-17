import type { JsonlRecord } from "@unquote/core";
import { createLocalFileAccess } from "../lib/local-file-source";
import type { LocalFileAccess } from "../lib/local-file-source";
import { parseTextResult } from "../lib/parse-text";
import type { SourceRevision } from "../lib/source-revision";
import { searchRecords } from "../lib/record-search";
import type { SearchOptions, SearchResultSet } from "../lib/record-search";

type TextSearchSource =
  | {
      kind: "content";
      sourceRevision: SourceRevision;
      text: string;
      forcedFormat?: "json" | "jsonl";
    }
  | {
      kind: "cached";
      sourceRevision: SourceRevision;
    };

export type SearchRequest =
  | {
      type: "search-text";
      requestId: number;
      source: TextSearchSource;
      query: string;
      options: SearchOptions;
      windowIndexes?: Float64Array;
    }
  | {
      type: "search-file";
      requestId: number;
      sourceRevision: SourceRevision;
      file: File;
      query: string;
      options: SearchOptions;
      windowIndexes?: Float64Array;
    };

export type SearchWorkerResponse =
  | { type: "result"; requestId: number; result: SearchResultSet | null }
  | { type: "error"; requestId: number; message: string };

interface TextRecordsCache {
  sourceRevision: SourceRevision;
  records: JsonlRecord[];
}

let textRecordsCache: TextRecordsCache | null = null;
let fileAccessCache: { sourceRevision: SourceRevision; access: LocalFileAccess } | null = null;

const recordsForSource = (source: TextSearchSource): JsonlRecord[] => {
  if (source.kind === "cached") {
    if (textRecordsCache?.sourceRevision !== source.sourceRevision) {
      throw new Error("Search source revision is unavailable");
    }
    return textRecordsCache.records;
  }

  const result = parseTextResult(source.text, source.forcedFormat);
  textRecordsCache = { sourceRevision: source.sourceRevision, records: result.records };
  return result.records;
};

const searchText = ({
  source,
  query,
  options,
  windowIndexes,
}: Extract<SearchRequest, { type: "search-text" }>): SearchResultSet | null =>
  searchRecords(recordsForSource(source), query, options, windowIndexes);

// Cancellation is handled by the main thread terminating this worker on
// timeout, so this signal never needs to fire.
const searchFile = ({
  file,
  sourceRevision,
  query,
  options,
  windowIndexes,
}: Extract<SearchRequest, { type: "search-file" }>): Promise<SearchResultSet | null> => {
  if (fileAccessCache?.sourceRevision !== sourceRevision) {
    fileAccessCache = { sourceRevision, access: createLocalFileAccess(file) };
  }
  return fileAccessCache.access.search(query, options, new AbortController().signal, windowIndexes);
};

// Never include the raw error, input text, or query in the posted message —
// the worker must not echo user input back through unrelated channels.
const errorMessage = (error: unknown) => (error instanceof Error ? error.name : "search failed");

self.onmessage = (event: MessageEvent<SearchRequest>) => {
  const message = event.data;

  if (message.type === "search-text") {
    try {
      const result = searchText(message);
      self.postMessage({
        type: "result",
        requestId: message.requestId,
        result,
      } satisfies SearchWorkerResponse);
    } catch (error) {
      self.postMessage({
        type: "error",
        requestId: message.requestId,
        message: errorMessage(error),
      } satisfies SearchWorkerResponse);
    }
    return;
  }

  searchFile(message)
    .then((result) => {
      self.postMessage({
        type: "result",
        requestId: message.requestId,
        result,
      } satisfies SearchWorkerResponse);
    })
    .catch((error: unknown) => {
      self.postMessage({
        type: "error",
        requestId: message.requestId,
        message: errorMessage(error),
      } satisfies SearchWorkerResponse);
    });
};
