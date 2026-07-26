import type { JsonlRecord } from "@unquote/core";
import { createLocalFileAccess } from "../lib/local-file-source";
import { parseTextResult } from "../lib/parse-text";
import type { SourceRevision } from "../lib/source-revision";
import { searchRecords } from "../lib/tree";
import type { SearchMatch, SearchOptions } from "../lib/tree";

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
    }
  | {
      type: "search-file";
      requestId: number;
      file: File;
      query: string;
      options: SearchOptions;
    };

export type SearchWorkerResponse =
  | { type: "result"; requestId: number; matches: SearchMatch[] | null }
  | { type: "error"; requestId: number; message: string };

interface TextRecordsCache {
  sourceRevision: SourceRevision;
  records: JsonlRecord[];
}

let textRecordsCache: TextRecordsCache | null = null;

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
}: Extract<SearchRequest, { type: "search-text" }>): SearchMatch[] | null =>
  searchRecords(recordsForSource(source), query, options);

// Cancellation is handled by the main thread terminating this worker on
// timeout, so this signal never needs to fire.
const searchFile = ({
  file,
  query,
  options,
}: Extract<SearchRequest, { type: "search-file" }>): Promise<SearchMatch[] | null> =>
  createLocalFileAccess(file).search(query, options, new AbortController().signal);

// Never include the raw error, input text, or query in the posted message —
// the worker must not echo user input back through unrelated channels.
const errorMessage = (error: unknown) => (error instanceof Error ? error.name : "search failed");

self.onmessage = (event: MessageEvent<SearchRequest>) => {
  const message = event.data;

  if (message.type === "search-text") {
    try {
      const matches = searchText(message);
      self.postMessage({
        type: "result",
        requestId: message.requestId,
        matches,
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
    .then((matches) => {
      self.postMessage({
        type: "result",
        requestId: message.requestId,
        matches,
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
