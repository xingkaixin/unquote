import { parseJsonlRecordLine } from "@unquote/core";
import type { JsonlRecord } from "@unquote/core";
import { drainJsonlLines } from "./jsonl-lines";

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

export const readJsonlLinesByNumber = async (
  file: File,
  lineNumbers: Set<number>,
  signal?: AbortSignal,
  maxBytes = Number.POSITIVE_INFINITY,
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
    if (file.size > maxBytes) {
      throw new SourceReadLimitError();
    }
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
  let collectedBytes = 0;
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
      collectedBytes += bytes.byteLength;
      if (collectedBytes > maxBytes) {
        throw new SourceReadLimitError();
      }
      lineChunks.push(bytes.slice());
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

  return lines;
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

/**
 * Parses the requested lines in file order and hands each Full Record to the
 * caller immediately, so only one record's AST is live at a time. Unlike
 * `resolveRecords`, nothing is accumulated here — the caller decides what to
 * keep.
 */
export const streamJsonlRecords = async (
  file: File,
  lineNumbers: ReadonlySet<number>,
  onRecord: (record: JsonlRecord) => void | Promise<void>,
  signal?: AbortSignal,
) => {
  if (lineNumbers.size === 0) {
    return;
  }

  let remaining = lineNumbers.size;
  await readJsonlFileLines(
    file,
    async (line, lineNumber) => {
      if (!lineNumbers.has(lineNumber)) {
        return true;
      }
      await onRecord(parseJsonlRecordLine(line, lineNumber));
      remaining -= 1;
      return remaining > 0;
    },
    signal,
  );
};
