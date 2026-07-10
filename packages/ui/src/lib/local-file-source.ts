import { parseJsonlRecordLine } from "@unquote/core";
import type { JsonlRecord } from "@unquote/core";
import { drainJsonlLines } from "./jsonl-lines";
import { buildSearchPattern, searchRecord } from "./tree";
import type { SearchMatch, SearchOptions } from "./tree";

export const fileSearchDebounceMs = 250;
export const hydratedFileRecordLimit = 500;

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

export const readJsonlFileLines = async (
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
        matches.push(...searchRecord(parseJsonlRecordLine(line, lineNumber), pattern, options));
      }
    },
    signal,
  );

  return signal.aborted ? null : matches;
};
