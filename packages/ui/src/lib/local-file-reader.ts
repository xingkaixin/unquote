import { parseJsonlRecordLine } from "@unquote/core";
import { drainJsonlLines } from "./jsonl-lines";

const lineCheckpointLimit = 64;

// Origin + byte buckets + the furthest scanned newline stay within this limit.
// Byte buckets bound repeated I/O; line-count spacing cannot when records vary in size.
const checkpointByteBucketCount = lineCheckpointLimit - 1;

export interface LineCheckpoint {
  lineNumber: number;
  byteOffset: number;
}

export class JsonlLineIndex {
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

  exportCheckpoints(): LineCheckpoint[] {
    const checkpoints = [...this.checkpointsByBucket.values()];
    if (this.frontierByteOffset > 0) {
      checkpoints.push({
        lineNumber: this.frontierLineNumber,
        byteOffset: this.frontierByteOffset,
      });
    }
    return checkpoints;
  }

  seedCheckpoints(checkpoints: readonly LineCheckpoint[]) {
    for (const checkpoint of checkpoints) {
      this.addCheckpoint(checkpoint.lineNumber, checkpoint.byteOffset);
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

export const seedJsonlLineCheckpoints = (file: File, checkpoints: readonly LineCheckpoint[]) => {
  if (checkpoints.length > 0) {
    lineIndexFor(file).seedCheckpoints(checkpoints);
  }
};

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

export const readFileText = async (
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

export const readJsonlFileLines = async (
  file: File,
  onLine: (line: string, lineNumber: number) => boolean | void | Promise<boolean | void>,
  signal?: AbortSignal,
) => {
  let lineNumber = 1;
  let stopped = false;
  const queuedLines: { line: string; lineNumber: number }[] = [];
  let pendingDecision: Promise<boolean | void> | null = null;
  const processLine = (line: string) => {
    if (signal?.aborted) {
      return false;
    }

    const currentLineNumber = lineNumber;
    lineNumber += 1;
    if (pendingDecision) {
      queuedLines.push({ line, lineNumber: currentLineNumber });
      return true;
    }

    const decision = onLine(line, currentLineNumber);
    if (decision instanceof Promise) {
      pendingDecision = decision;
      return true;
    }
    stopped = decision === false;
    return !stopped;
  };
  const finishQueuedLines = async () => {
    if (pendingDecision) {
      stopped = (await pendingDecision) === false;
      pendingDecision = null;
    }
    for (const queued of queuedLines) {
      if (stopped || signal?.aborted) {
        stopped = true;
        break;
      }
      const decision = onLine(queued.line, queued.lineNumber);
      stopped = (decision instanceof Promise ? await decision : decision) === false;
      if (stopped) {
        break;
      }
    }
    queuedLines.length = 0;
  };

  if (typeof file.stream !== "function") {
    try {
      const text = await readFileText(file, () => undefined, signal);
      drainJsonlLines("", text, true, processLine);
      await finishQueuedLines();
    } catch (error) {
      if (!signal?.aborted) {
        throw error;
      }
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
        await finishQueuedLines();
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
      await finishQueuedLines();
    }
  } catch (error) {
    stopped = true;
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

export class SourceReadLimitError extends Error {
  constructor() {
    super("Source read exceeds the byte limit");
  }
}

const emptyBytes = new Uint8Array(0);

interface ScanJsonlLinesOptions {
  signal?: AbortSignal | undefined;
  maxBytes?: number | undefined;
  batchMaxLines?: number | undefined;
  batchMaxBytes?: number | undefined;
  onBatch?: ((lines: Map<number, string>) => void | Promise<void>) | undefined;
}

const scanJsonlLinesByNumber = async (
  file: File,
  lineNumbers: ReadonlySet<number>,
  {
    signal,
    maxBytes = Number.POSITIVE_INFINITY,
    batchMaxLines = Number.POSITIVE_INFINITY,
    batchMaxBytes = Number.POSITIVE_INFINITY,
    onBatch,
  }: ScanJsonlLinesOptions = {},
): Promise<Map<number, string>> => {
  signal?.throwIfAborted();
  const collected = new Map<number, string>();
  if (lineNumbers.size === 0) {
    return collected;
  }

  let firstRequestedLine = Number.POSITIVE_INFINITY;
  let lastRequestedLine = 0;
  for (const lineNumber of lineNumbers) {
    if (lineNumber < firstRequestedLine) firstRequestedLine = lineNumber;
    if (lineNumber > lastRequestedLine) lastRequestedLine = lineNumber;
  }
  const lineIndex = lineIndexFor(file);
  const scanRange = lineIndex.scanRange(firstRequestedLine, lastRequestedLine);
  const slicedFile = file.slice(scanRange.start.byteOffset, scanRange.end?.byteOffset ?? file.size);

  let collectedBytes = 0;
  let matchedCount = 0;
  let batch = collected;
  let batchBytes = 0;

  const flushBatch = async () => {
    if (!onBatch || batch.size === 0) {
      return;
    }
    const ready = batch;
    batch = new Map();
    batchBytes = 0;
    await onBatch(ready);
    signal?.throwIfAborted();
  };

  const pushMatchedLine = async (lineNumber: number, text: string, byteLength: number) => {
    if (collectedBytes + byteLength > maxBytes) {
      await flushBatch();
      throw new SourceReadLimitError();
    }
    collectedBytes += byteLength;
    matchedCount += 1;
    if (onBatch && batch.size > 0 && batchBytes + byteLength > batchMaxBytes) {
      await flushBatch();
    }
    batch.set(lineNumber, text);
    batchBytes += byteLength;
    if (onBatch && (batch.size >= batchMaxLines || batchBytes >= batchMaxBytes)) {
      await flushBatch();
    }
    return matchedCount < lineNumbers.size;
  };

  if (typeof slicedFile.stream !== "function") {
    if (!onBatch && file.size > maxBytes) {
      throw new SourceReadLimitError();
    }
    const matched: Array<[number, string]> = [];
    await readJsonlFileLines(
      file,
      (line, lineNumber) => {
        if (lineNumbers.has(lineNumber)) {
          matched.push([lineNumber, line]);
        }
        return matched.length < lineNumbers.size;
      },
      signal,
    );
    signal?.throwIfAborted();
    const encoder = onBatch ? new TextEncoder() : null;
    for (const [lineNumber, line] of matched) {
      signal?.throwIfAborted();
      await pushMatchedLine(lineNumber, line, encoder ? encoder.encode(line).byteLength : 0);
    }
    await flushBatch();
    return collected;
  }

  const reader = slicedFile.stream().getReader();
  let lineNumber = scanRange.start.lineNumber;
  let absoluteOffset = scanRange.start.byteOffset;
  let lineChunks: Uint8Array[] = [];
  let lineChunkBytes = 0;
  let stopped = false;
  let readerCanceled = false;
  const decoder = new TextDecoder();

  const cancelReader = () => {
    readerCanceled = true;
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", cancelReader, { once: true });

  const emitLine = async (trailing: Uint8Array) => {
    let raw = trailing;
    if (lineChunks.length > 0) {
      raw = new Uint8Array(lineChunkBytes + trailing.byteLength);
      let writeOffset = 0;
      for (const chunk of lineChunks) {
        raw.set(chunk, writeOffset);
        writeOffset += chunk.byteLength;
      }
      raw.set(trailing, writeOffset);
      lineChunks = [];
      lineChunkBytes = 0;
    }
    const trimmed = raw.at(-1) === 13 ? raw.subarray(0, -1) : raw;
    if (collectedBytes + trimmed.byteLength > maxBytes) {
      await flushBatch();
      throw new SourceReadLimitError();
    }
    return pushMatchedLine(lineNumber, decoder.decode(trimmed), trimmed.byteLength);
  };

  try {
    while (!stopped && !signal?.aborted) {
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      if (done) {
        if (lineChunks.length > 0) {
          await emitLine(emptyBytes);
        }
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

        if (lineNumbers.has(lineNumber)) {
          stopped = !(await emitLine(value.subarray(segmentStart, index)));
        }
        lineNumber += 1;
        lineIndex.addCheckpoint(lineNumber, absoluteOffset + index + 1);
        segmentStart = index + 1;
        if (stopped || signal?.aborted) {
          stopped = true;
          break;
        }
      }

      if (
        !stopped &&
        !signal?.aborted &&
        segmentStart < value.byteLength &&
        lineNumbers.has(lineNumber)
      ) {
        const segment = value.subarray(segmentStart);
        // Check against the cumulative budget before buffering an oversized partial line.
        if (collectedBytes + lineChunkBytes + segment.byteLength > maxBytes + 1) {
          await flushBatch();
          throw new SourceReadLimitError();
        }
        lineChunks.push(segment.slice());
        lineChunkBytes += segment.byteLength;
      }
      absoluteOffset += value.byteLength;
    }
  } catch (error) {
    stopped = true;
    throw signal?.aborted ? signal.reason : error;
  } finally {
    signal?.removeEventListener("abort", cancelReader);
    if ((stopped || signal?.aborted) && !readerCanceled) {
      await reader.cancel().catch(() => undefined);
    }
  }

  signal?.throwIfAborted();
  await flushBatch();
  return collected;
};

export const readJsonlLinesByNumber = (
  file: File,
  lineNumbers: ReadonlySet<number>,
  signal?: AbortSignal,
  maxBytes = Number.POSITIVE_INFINITY,
) => scanJsonlLinesByNumber(file, lineNumbers, { signal, maxBytes });

export const streamJsonlLineBatches = async (
  file: File,
  lineNumbers: ReadonlySet<number>,
  onBatch: (lines: Map<number, string>) => void | Promise<void>,
  options: {
    signal?: AbortSignal | undefined;
    maxBytes?: number | undefined;
    batchMaxLines?: number | undefined;
    batchMaxBytes?: number | undefined;
  } = {},
) => {
  await scanJsonlLinesByNumber(file, lineNumbers, { ...options, onBatch });
};

export const readJsonlRecordsByLine = async (
  file: File,
  lineNumbers: Set<number>,
  signal?: AbortSignal,
) => {
  const lines = await readJsonlLinesByNumber(file, lineNumbers, signal);
  return new Map(
    [...lines].map(([lineNumber, line]) => [lineNumber, parseJsonlRecordLine(line, lineNumber)]),
  );
};
