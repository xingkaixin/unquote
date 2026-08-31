import { createLocalFileAccess } from "../lib/local-file-source";
import type { LocalFileAccess } from "../lib/local-file-source";
import { parseTextResult } from "../lib/parse-text-result";
import type { SourceRevision } from "../lib/source-revision";
import { createMemorySearch } from "../lib/memory-search";
import type { SearchOptions, SearchResultSet, SearchResultWindow } from "../lib/record-search";

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
  | { type: "window"; requestId: number; window: SearchResultWindow }
  | { type: "error"; requestId: number; message: string };

type SearchSourceCache =
  | {
      kind: "memory";
      sourceRevision: SourceRevision;
      search: ReturnType<typeof createMemorySearch>;
    }
  | { kind: "file"; sourceRevision: SourceRevision; access: LocalFileAccess };

let sourceCache: SearchSourceCache | null = null;

const searchForSource = (source: TextSearchSource) => {
  if (source.kind === "cached") {
    if (sourceCache?.kind !== "memory" || sourceCache.sourceRevision !== source.sourceRevision) {
      throw new Error("Search source revision is unavailable");
    }
    return sourceCache.search;
  }

  const result = parseTextResult(source.text, source.forcedFormat);
  const search = createMemorySearch(result.records);
  sourceCache = { kind: "memory", sourceRevision: source.sourceRevision, search };
  return search;
};

const searchText = ({
  source,
  query,
  options,
  windowIndexes,
}: Extract<SearchRequest, { type: "search-text" }>): SearchResultSet | null =>
  searchForSource(source)(query, options, windowIndexes);

// Cancellation is handled by the main thread terminating this worker on
// timeout, so this signal never needs to fire.
const searchFile = ({
  file,
  sourceRevision,
  query,
  options,
  windowIndexes,
}: Extract<SearchRequest, { type: "search-file" }>): Promise<SearchResultSet | null> => {
  if (sourceCache?.kind !== "file" || sourceCache.sourceRevision !== sourceRevision) {
    sourceCache = { kind: "file", sourceRevision, access: createLocalFileAccess(file) };
  }
  return sourceCache.access.search(query, options, new AbortController().signal, windowIndexes);
};

// Never include the raw error, input text, or query in the posted message —
// the worker must not echo user input back through unrelated channels.
const errorMessage = (error: unknown) => (error instanceof Error ? error.name : "search failed");

const postResult = (request: SearchRequest, result: SearchResultSet | null) => {
  const response: SearchWorkerResponse =
    request.windowIndexes && result
      ? { type: "window", requestId: request.requestId, window: result.window }
      : { type: "result", requestId: request.requestId, result };
  self.postMessage(response);
};

self.onmessage = (event: MessageEvent<SearchRequest>) => {
  const message = event.data;

  if (message.type === "search-text") {
    try {
      const result = searchText(message);
      postResult(message, result);
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
      postResult(message, result);
    })
    .catch((error: unknown) => {
      self.postMessage({
        type: "error",
        requestId: message.requestId,
        message: errorMessage(error),
      } satisfies SearchWorkerResponse);
    });
};
