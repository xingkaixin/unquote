import { parseJsonlRecordLine, stringifyJsonNode } from "@unquote/core";
import type { JsonlRecord } from "@unquote/core";
import { drainJsonlLines } from "./jsonl-lines";
import { measurePerfAsync } from "./perf";
import {
  buildSearchPattern,
  createSearchResultCollector,
  normalizeSearchWindowIndexes,
  searchRecords,
} from "./record-search";
import type { SearchOptions, SearchResultSet } from "./record-search";

export const fullRecordCacheLimit = 500;

const lineCheckpointLimit = 64;
// Origin + byte buckets + the furthest scanned newline stay within this limit.
// Byte buckets bound repeated I/O; line-count spacing cannot when records vary in size.
const checkpointByteBucketCount = lineCheckpointLimit - 1;

interface LineCheckpoint {
  lineNumber: number;
  byteOffset: number;
}

class JsonlLineIndex {
  private readonly byteBucketSize: number;
  private readonly checkpointsByBucket = new Map<number, LineCheckpoint>();
  private frontierLineNumber = 1;
  private frontierByteOffset = 0;

  constructor(fileSize: number) {
    this.byteBucketSize = Math.max(1, Math.ceil(fileSize / checkpointByteBucketCount));
  }

  scanRange(
    firstLine: number,
    lastLine: number,
  ): { start: LineCheckpoint; end: LineCheckpoint | null } {
    let start: LineCheckpoint = { lineNumber: 1, byteOffset: 0 };
    let end: LineCheckpoint | null = null;
    const consider = (checkpoint: LineCheckpoint) => {
      if (checkpoint.lineNumber <= firstLine && checkpoint.lineNumber > start.lineNumber) {
        start = checkpoint;
      }
      if (checkpoint.lineNumber > lastLine && (!end || checkpoint.lineNumber < end.lineNumber)) {
        end = checkpoint;
      }
    };

    for (const checkpoint of this.checkpointsByBucket.values()) {
      consider(checkpoint);
    }
    consider({
      lineNumber: this.frontierLineNumber,
      byteOffset: this.frontierByteOffset,
    });
    return { start, end };
  }

  addCheckpoint(lineNumber: number, byteOffset: number) {
    if (byteOffset > this.frontierByteOffset) {
      this.frontierLineNumber = lineNumber;
      this.frontierByteOffset = byteOffset;
    }

    const bucket = Math.floor(byteOffset / this.byteBucketSize);
    if (bucket > 0 && bucket < checkpointByteBucketCount && !this.checkpointsByBucket.has(bucket)) {
      this.checkpointsByBucket.set(bucket, { lineNumber, byteOffset });
    }
  }
}

const jsonlLineIndexes = new WeakMap<File, JsonlLineIndex>();

const lineIndexFor = (file: File) => {
  let index = jsonlLineIndexes.get(file);
  if (!index) {
    index = new JsonlLineIndex(file.size);
    jsonlLineIndexes.set(file, index);
  }
  return index;
};

export type { SearchMatch, SearchOptions } from "./record-search";

// Distinguishable from a genuine read failure, which the caller surfaces to
// the user; an abort is expected and silent.
const readAbortError = () => new DOMException("File read aborted", "AbortError");

const readFileWithFileReader = (
  file: Blob,
  onProgress: (progress: number) => void,
  signal?: AbortSignal,
) =>
  new Promise<string>((resolve, reject) => {
    if (signal?.aborted) {
      reject(readAbortError());
      return;
    }

    const reader = new FileReader();
    const cancelRead = () => reader.abort();
    const finish = (settle: () => void) => {
      signal?.removeEventListener("abort", cancelRead);
      settle();
    };

    reader.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(event.total === 0 ? 1 : event.loaded / event.total);
      }
    };
    reader.onload = () =>
      finish(() => {
        onProgress(1);
        resolve(typeof reader.result === "string" ? reader.result : "");
      });
    reader.onerror = () => finish(() => reject(reader.error ?? new Error("Failed to read file")));
    reader.onabort = () => finish(() => reject(readAbortError()));

    signal?.addEventListener("abort", cancelRead, { once: true });
    reader.readAsText(file);
  });

const readFileText = async (
  file: Blob,
  onProgress: (progress: number) => void,
  signal?: AbortSignal,
) => {
  if (typeof file.stream !== "function") {
    if (typeof file.text === "function") {
      // Not interruptible, so the guard is on the result rather than the work.
      const text = await file.text();
      if (signal?.aborted) {
        throw readAbortError();
      }
      onProgress(1);
      return text;
    }

    return readFileWithFileReader(file, onProgress, signal);
  }

  const reader = file.stream().getReader();
  const decoder = new TextDecoder();
  const cancelReader = () => void reader.cancel().catch(() => undefined);
  signal?.addEventListener("abort", cancelReader, { once: true });
  let text = "";
  let bytesRead = 0;

  try {
    while (true) {
      if (signal?.aborted) {
        throw readAbortError();
      }

      const { value, done } = await reader.read();
      if (signal?.aborted) {
        throw readAbortError();
      }
      if (done) {
        break;
      }

      if (value) {
        bytesRead += value.byteLength;
        text += decoder.decode(value, { stream: true });
        onProgress(file.size === 0 ? 1 : bytesRead / file.size);
      }
    }
  } finally {
    signal?.removeEventListener("abort", cancelReader);
  }

  text += decoder.decode();
  onProgress(1);
  return text;
};

export const readFileHead = (file: File, maxBytes: number, signal?: AbortSignal) => {
  const head = file.slice(0, maxBytes);
  return typeof head.stream !== "function" && typeof FileReader !== "undefined"
    ? readFileWithFileReader(head, () => undefined, signal)
    : readFileText(head, () => undefined, signal);
};

const readJsonlFileLines = async (
  file: File,
  onLine: (line: string, lineNumber: number) => boolean | void,
  signal?: AbortSignal,
) => {
  let lineNumber = 1;
  let stopped = false;
  const processLine = (line: string) => {
    if (signal?.aborted) {
      return false;
    }

    stopped = onLine(line, lineNumber) === false;
    lineNumber += 1;
    return !stopped;
  };
  const processRawLine = (rawLine: string) =>
    processLine(rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine);

  if (typeof file.stream !== "function") {
    const text = await readFileText(file, () => undefined, signal);
    for (const rawLine of text.split("\n")) {
      if (stopped || signal?.aborted) {
        break;
      }
      processRawLine(rawLine);
    }
    return;
  }

  const reader = file.stream().getReader();
  const decoder = new TextDecoder();
  const lineIndex = lineIndexFor(file);
  let absoluteByteOffset = 0;
  let buffer = "";
  let readerCanceled = false;

  const cancelReader = () => {
    readerCanceled = true;
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", cancelReader, { once: true });

  try {
    while (!stopped && !signal?.aborted) {
      const { value, done } = await reader.read();
      if (done) {
        const drained = drainJsonlLines(buffer, decoder.decode(), true, processLine);
        buffer = drained.buffer;
        stopped = stopped || drained.stopped;
        break;
      }

      if (!value) {
        continue;
      }

      let checkpointLineNumber = lineNumber;
      for (let index = 0; index < value.byteLength; index += 1) {
        if (value[index] === 10) {
          checkpointLineNumber += 1;
          lineIndex.addCheckpoint(checkpointLineNumber, absoluteByteOffset + index + 1);
        }
      }

      const drained = drainJsonlLines(
        buffer,
        decoder.decode(value, { stream: true }),
        false,
        processLine,
      );
      buffer = drained.buffer;
      stopped = stopped || drained.stopped;
      absoluteByteOffset += value.byteLength;
    }
  } catch (error) {
    if (!signal?.aborted) {
      throw error;
    }
  } finally {
    signal?.removeEventListener("abort", cancelReader);
    if ((stopped || signal?.aborted) && !readerCanceled) {
      await reader.cancel().catch(() => undefined);
    }
  }
};

const readJsonlLinesByNumber = async (
  file: File,
  lineNumbers: Set<number>,
  signal?: AbortSignal,
) => {
  const lines = new Map<number, string>();
  if (lineNumbers.size === 0) {
    return lines;
  }

  let firstRequestedLine = Number.POSITIVE_INFINITY;
  let lastRequestedLine = 0;
  for (const lineNumber of lineNumbers) {
    firstRequestedLine = Math.min(firstRequestedLine, lineNumber);
    lastRequestedLine = Math.max(lastRequestedLine, lineNumber);
  }
  const lineIndex = lineIndexFor(file);
  const scanRange = lineIndex.scanRange(firstRequestedLine, lastRequestedLine);
  const slicedFile = file.slice(scanRange.start.byteOffset, scanRange.end?.byteOffset ?? file.size);

  if (typeof slicedFile.stream !== "function") {
    await readJsonlFileLines(
      file,
      (line, lineNumber) => {
        if (lineNumbers.has(lineNumber)) {
          lines.set(lineNumber, line);
        }
        return lines.size < lineNumbers.size;
      },
      signal,
    );
    return lines;
  }

  const reader = slicedFile.stream().getReader();
  let lineNumber = scanRange.start.lineNumber;
  let absoluteOffset = scanRange.start.byteOffset;
  let lineChunks: Uint8Array[] = [];
  let stopped = false;
  let readerCanceled = false;
  const decoder = new TextDecoder();

  const cancelReader = () => {
    readerCanceled = true;
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", cancelReader, { once: true });

  const withoutCarriageReturn = (bytes: Uint8Array) =>
    bytes.at(-1) === 13 ? bytes.subarray(0, -1) : bytes;

  // Only a line split across chunks needs its pieces merged; the common case
  // decodes the chunk's own bytes in place.
  const decodeCollectedLine = () => {
    const [only] = lineChunks;
    if (lineChunks.length === 1 && only) {
      return decoder.decode(withoutCarriageReturn(only));
    }

    const byteLength = lineChunks.reduce((total, chunk) => total + chunk.byteLength, 0);
    const bytes = new Uint8Array(byteLength);
    let writeOffset = 0;
    for (const chunk of lineChunks) {
      bytes.set(chunk, writeOffset);
      writeOffset += chunk.byteLength;
    }
    return decoder.decode(withoutCarriageReturn(bytes));
  };

  // Locating a line only needs newline positions, so bytes are collected for
  // requested lines alone: skipped lines advance the counters and nothing else.
  const collectLineBytes = (bytes: Uint8Array) => {
    if (lineNumbers.has(lineNumber)) {
      lineChunks.push(bytes);
    }
  };

  const processLine = () => {
    if (lineChunks.length > 0) {
      lines.set(lineNumber, decodeCollectedLine());
      lineChunks = [];
    }
    return lines.size < lineNumbers.size;
  };

  try {
    while (!stopped && !signal?.aborted) {
      const { value, done } = await reader.read();
      if (done) {
        processLine();
        break;
      }
      if (!value) {
        continue;
      }

      let segmentStart = 0;
      for (let index = 0; index < value.byteLength; index++) {
        if (value[index] !== 10) {
          continue;
        }

        collectLineBytes(value.subarray(segmentStart, index));
        stopped = !processLine();
        lineNumber += 1;
        lineIndex.addCheckpoint(lineNumber, absoluteOffset + index + 1);
        segmentStart = index + 1;
        if (stopped) {
          break;
        }
      }

      if (!stopped && segmentStart < value.byteLength) {
        collectLineBytes(value.subarray(segmentStart));
      }
      absoluteOffset += value.byteLength;
    }
  } catch (error) {
    if (!signal?.aborted) {
      throw error;
    }
  } finally {
    signal?.removeEventListener("abort", cancelReader);
    if ((stopped || signal?.aborted) && !readerCanceled) {
      await reader.cancel().catch(() => undefined);
    }
  }

  return lines;
};

const readJsonlRecordsByLine = async (
  file: File,
  lineNumbers: Set<number>,
  signal?: AbortSignal,
) => {
  const lines = await readJsonlLinesByNumber(file, lineNumbers, signal);
  return new Map(
    [...lines].map(([lineNumber, line]) => [lineNumber, parseJsonlRecordLine(line, lineNumber)]),
  );
};

/**
 * Parses the requested lines in file order and hands each Full Record to the
 * caller immediately, so only one record's AST is live at a time. Unlike
 * `resolveRecords`, nothing is accumulated here — the caller decides what to
 * keep.
 */
const streamJsonlRecords = async (
  file: File,
  lineNumbers: ReadonlySet<number>,
  onRecord: (record: JsonlRecord) => void,
  signal?: AbortSignal,
) => {
  if (lineNumbers.size === 0) {
    return;
  }

  let remaining = lineNumbers.size;
  await readJsonlFileLines(
    file,
    (line, lineNumber) => {
      if (!lineNumbers.has(lineNumber)) {
        return true;
      }
      onRecord(parseJsonlRecordLine(line, lineNumber));
      remaining -= 1;
      return remaining > 0;
    },
    signal,
  );
};

const unsafeRawProbePattern = /[^\x20-\x7e]|["\\/]/;
const numericLabelPattern = /^[\d.eE+-]+$/;
const containerLabelPattern = /^[\d[\]{}]+$/;

const buildRawLineProbe = (
  query: string,
  options: SearchOptions,
  searchPattern: RegExp,
): RegExp | null => {
  // Numbers, containers, paths, and escaped strings can match text absent from the raw JSON.
  if (
    options.syntax !== "text" ||
    unsafeRawProbePattern.test(query) ||
    numericLabelPattern.test(query) ||
    containerLabelPattern.test(query)
  ) {
    return null;
  }

  return new RegExp(searchPattern.source, options.caseSensitive ? "" : "i");
};

const rawLineMayMatch = (line: string, probe: RegExp | null) =>
  !probe || line.includes("\\u") || probe.test(line);

const searchJsonlFile = async (
  file: File,
  query: string,
  options: SearchOptions,
  signal: AbortSignal,
  windowIndexes?: ArrayLike<number>,
): Promise<SearchResultSet | null> =>
  measurePerfAsync("search:file", async () => {
    const pattern = buildSearchPattern(query, options);
    if (!pattern) {
      return null;
    }
    const rawLineProbe = buildRawLineProbe(query, options, pattern);
    const collector = createSearchResultCollector(pattern, options, windowIndexes);

    await readJsonlFileLines(
      file,
      (line, lineNumber) => {
        if (signal.aborted) {
          return false;
        }

        if (line.trim() && rawLineMayMatch(line, rawLineProbe)) {
          try {
            const record = parseJsonlRecordLine(line, lineNumber);
            collector.addRecord(record);
          } catch {
            // Invalid JSONL lines are excluded from search, matching the record-tree path.
          }
        }
      },
      signal,
    );

    return signal.aborted ? null : collector.finish();
  });

interface FileSearchCache {
  query: string;
  options: SearchOptions;
  result: SearchResultSet;
}

interface RequestedLineMatches {
  firstGlobalIndex: number;
  globalIndexes: number[];
}

const hasSameSearch = (cache: FileSearchCache, query: string, options: SearchOptions) =>
  cache.query === query &&
  cache.options.syntax === options.syntax &&
  cache.options.caseSensitive === options.caseSensitive;

const firstMatchIndexForLine = (lineNumbers: Float64Array, lineNumber: number) => {
  let low = 0;
  let high = lineNumbers.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (lineNumbers[middle]! < lineNumber) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
};

const materializeSearchWindow = async (
  file: File,
  cache: FileSearchCache,
  signal: AbortSignal,
  windowIndexes: ArrayLike<number>,
): Promise<SearchResultSet | null> => {
  const requestedIndexes = normalizeSearchWindowIndexes(windowIndexes)!;
  const requestedByLine = new Map<number, RequestedLineMatches>();
  for (const globalIndex of requestedIndexes) {
    const lineNumber = cache.result.matchLineNumbers[globalIndex];
    if (lineNumber === undefined) {
      continue;
    }
    const request = requestedByLine.get(lineNumber) ?? {
      firstGlobalIndex: firstMatchIndexForLine(cache.result.matchLineNumbers, lineNumber),
      globalIndexes: [],
    };
    request.globalIndexes.push(globalIndex);
    requestedByLine.set(lineNumber, request);
  }

  const records = await readJsonlRecordsByLine(file, new Set(requestedByLine.keys()), signal);
  if (signal.aborted) {
    return null;
  }

  const materialized: {
    globalIndex: number;
    match: SearchResultSet["window"]["matches"][number];
  }[] = [];
  for (const [lineNumber, request] of requestedByLine) {
    const record = records.get(lineNumber);
    if (!record) {
      continue;
    }
    const localIndexes = Float64Array.from(
      request.globalIndexes.map((globalIndex) => globalIndex - request.firstGlobalIndex),
    );
    const localResult = searchRecords([record], cache.query, cache.options, localIndexes);
    if (!localResult) {
      continue;
    }
    localResult.window.matches.forEach((match, index) => {
      const localIndex = localResult.window.matchIndexes[index];
      if (localIndex !== undefined) {
        materialized.push({ globalIndex: request.firstGlobalIndex + localIndex, match });
      }
    });
  }
  materialized.sort((left, right) => left.globalIndex - right.globalIndex);

  return {
    total: cache.result.total,
    matchLineNumbers: cache.result.matchLineNumbers,
    window: {
      matchIndexes: Float64Array.from(materialized.map(({ globalIndex }) => globalIndex)),
      matches: materialized.map(({ match }) => match),
    },
  };
};

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
  let searchCache: FileSearchCache | null = null;

  return {
    name: file.name,
    size: file.size,
    getFile: () => file,
    readText: (onProgress, signal) => readFileText(file, onProgress, signal),
    readRecords: (lineNumbers, signal) =>
      readJsonlRecordsByLine(file, new Set(lineNumbers), signal),
    resolveRecords: async (records, signal) => {
      const resolved = await readJsonlRecordsByLine(
        file,
        new Set(records.map((record) => record.lineNumber)),
        signal,
      );
      return records.map((record) => resolved.get(record.lineNumber) ?? record);
    },
    streamRecords: (lineNumbers, onRecord, signal) =>
      streamJsonlRecords(file, lineNumbers, onRecord, signal),
    readRecordText: async (record, signal) => {
      const resolved = (
        await readJsonlRecordsByLine(file, new Set([record.lineNumber]), signal)
      ).get(record.lineNumber);
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
    search: async (query, options, signal, windowIndexes) => {
      const cachedSearch = searchCache;
      if (cachedSearch && hasSameSearch(cachedSearch, query, options)) {
        return windowIndexes
          ? measurePerfAsync("search:file", () =>
              materializeSearchWindow(file, cachedSearch, signal, windowIndexes),
            )
          : cachedSearch.result;
      }

      const result = await searchJsonlFile(file, query, options, signal, windowIndexes);
      if (result && !signal.aborted) {
        searchCache = { query, options: { ...options }, result };
      }
      return result;
    },
  };
};
