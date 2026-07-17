import { parseJson, parseJsonlRecordLine } from "@unquote/core";
import type { JsonlRecord } from "@unquote/core";
import { drainJsonlLines } from "./jsonl-lines";
import { buildSearchPattern, searchJsonValue } from "./tree";
import type { SearchMatch, SearchOptions } from "./tree";

export const fileSearchDebounceMs = 250;
export const hydratedFileRecordLimit = 500;

const lineCheckpointInterval = 128;
const lineCheckpointLimit = 64;

interface LineCheckpoint {
  lineNumber: number;
  byteOffset: number;
}

class JsonlLineIndex {
  private readonly checkpoints = new Map<number, number>([[1, 0]]);

  nearestCheckpoint(lineNumber: number): LineCheckpoint {
    let nearest: LineCheckpoint = { lineNumber: 1, byteOffset: 0 };
    for (const [checkpointLine, byteOffset] of this.checkpoints) {
      if (checkpointLine <= lineNumber && checkpointLine > nearest.lineNumber) {
        nearest = { lineNumber: checkpointLine, byteOffset };
      }
    }
    return nearest;
  }

  addCheckpoint(lineNumber: number, byteOffset: number) {
    if ((lineNumber - 1) % lineCheckpointInterval !== 0 || this.checkpoints.has(lineNumber)) {
      return;
    }

    this.checkpoints.set(lineNumber, byteOffset);
    while (this.checkpoints.size > lineCheckpointLimit) {
      const oldest = [...this.checkpoints.keys()].find((candidate) => candidate !== 1);
      if (oldest === undefined) {
        return;
      }
      this.checkpoints.delete(oldest);
    }
  }
}

const jsonlLineIndexes = new WeakMap<File, JsonlLineIndex>();

const lineIndexFor = (file: File) => {
  let index = jsonlLineIndexes.get(file);
  if (!index) {
    index = new JsonlLineIndex();
    jsonlLineIndexes.set(file, index);
  }
  return index;
};

export type { SearchMatch, SearchOptions } from "./tree";

const readFileWithFileReader = (file: File, onProgress: (progress: number) => void) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(event.total === 0 ? 1 : event.loaded / event.total);
      }
    };
    reader.onload = () => {
      onProgress(1);
      resolve(typeof reader.result === "string" ? reader.result : "");
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsText(file);
  });

export const readFileText = async (file: File, onProgress: (progress: number) => void) => {
  if (typeof file.stream !== "function") {
    if (typeof file.text === "function") {
      const text = await file.text();
      onProgress(1);
      return text;
    }

    return readFileWithFileReader(file, onProgress);
  }

  const reader = file.stream().getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytesRead = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    if (value) {
      bytesRead += value.byteLength;
      text += decoder.decode(value, { stream: true });
      onProgress(file.size === 0 ? 1 : bytesRead / file.size);
    }
  }

  text += decoder.decode();
  onProgress(1);
  return text;
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
    const text = await readFileText(file, () => undefined);
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

      const drained = drainJsonlLines(
        buffer,
        decoder.decode(value, { stream: true }),
        false,
        processLine,
      );
      buffer = drained.buffer;
      stopped = stopped || drained.stopped;
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

export const readJsonlRecordsByLine = async (
  file: File,
  lineNumbers: Set<number>,
  signal?: AbortSignal,
) => {
  const records = new Map<number, JsonlRecord>();
  if (lineNumbers.size === 0) {
    return records;
  }

  let firstRequestedLine = Number.POSITIVE_INFINITY;
  for (const lineNumber of lineNumbers) {
    firstRequestedLine = Math.min(firstRequestedLine, lineNumber);
  }
  const lineIndex = lineIndexFor(file);
  const checkpoint = lineIndex.nearestCheckpoint(firstRequestedLine);
  const slicedFile = file.slice(checkpoint.byteOffset);

  if (typeof slicedFile.stream !== "function") {
    await readJsonlFileLines(
      file,
      (line, lineNumber) => {
        if (lineNumbers.has(lineNumber)) {
          records.set(lineNumber, parseJsonlRecordLine(line, lineNumber));
        }
        return records.size < lineNumbers.size;
      },
      signal,
    );
    return records;
  }

  const reader = slicedFile.stream().getReader();
  let lineNumber = checkpoint.lineNumber;
  let absoluteOffset = checkpoint.byteOffset;
  let lineChunks: Uint8Array[] = [];
  let stopped = false;
  let readerCanceled = false;
  const decoder = new TextDecoder();

  const cancelReader = () => {
    readerCanceled = true;
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", cancelReader, { once: true });

  const processLine = () => {
    const byteLength = lineChunks.reduce((total, chunk) => total + chunk.byteLength, 0);
    const bytes = new Uint8Array(byteLength);
    let writeOffset = 0;
    for (const chunk of lineChunks) {
      bytes.set(chunk, writeOffset);
      writeOffset += chunk.byteLength;
    }
    const content = bytes.at(-1) === 13 ? bytes.subarray(0, -1) : bytes;
    if (lineNumbers.has(lineNumber)) {
      records.set(lineNumber, parseJsonlRecordLine(decoder.decode(content), lineNumber));
    }
    lineChunks = [];
    return records.size < lineNumbers.size;
  };

  try {
    while (!stopped && !signal?.aborted) {
      const { value, done } = await reader.read();
      if (done) {
        if (lineChunks.some((chunk) => chunk.byteLength > 0)) {
          processLine();
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

        lineChunks.push(value.subarray(segmentStart, index));
        stopped = !processLine();
        lineNumber += 1;
        lineIndex.addCheckpoint(lineNumber, absoluteOffset + index + 1);
        segmentStart = index + 1;
        if (stopped) {
          break;
        }
      }

      if (!stopped && segmentStart < value.byteLength) {
        lineChunks.push(value.subarray(segmentStart));
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

  return records;
};

export const searchJsonlFile = async (
  file: File,
  query: string,
  options: SearchOptions,
  signal: AbortSignal,
): Promise<SearchMatch[] | null> => {
  const pattern = buildSearchPattern(query, options);
  if (!pattern) {
    return null;
  }

  const matches: SearchMatch[] = [];
  await readJsonlFileLines(
    file,
    (line, lineNumber) => {
      if (signal.aborted) {
        return false;
      }

      if (line.trim()) {
        try {
          for (const match of searchJsonValue(
            parseJson(line),
            `record-${lineNumber}`,
            pattern,
            options,
          )) {
            matches.push(match);
          }
        } catch {
          // Invalid JSONL lines are excluded from search, matching the record-tree path.
        }
      }
    },
    signal,
  );

  return signal.aborted ? null : matches;
};
