import { createFullJsonlRecord } from "./record-builder.js";
import type { FullJsonlRecord, LosslessJsonValue, ParseOptions } from "./types.js";
import { resolveMaxDepth } from "./utils.js";

const sseFieldNames = ["data", "event", "id", "retry"] as const;

const sseFieldAt = (input: string, start: number) =>
  sseFieldNames.find((name) => {
    if (!input.startsWith(name, start)) {
      return false;
    }
    const next = input[start + name.length];
    return next === undefined || next === ":" || next === "\n" || next === "\r";
  });

/**
 * Checks the first non-blank lines: each must be an SSE comment or a known
 * SSE field, and at least one must be `data`. Shared by `parseInput`
 * auto-detection and the UI's detection and streaming decision.
 */
export const isLikelySse = (input: string, sampleLimit = 8) => {
  let sampled = 0;
  let hasData = false;
  let start = input.startsWith("\uFEFF") ? 1 : 0;

  // Reads line prefixes only, so a large single-line JSON document is rejected
  // at its first character instead of being scanned for a newline.
  while (sampled < sampleLimit) {
    let first = start;
    while (input[first] === " " || input[first] === "\t" || input[first] === "\r") {
      first += 1;
    }
    if (first < input.length && input[first] !== "\n") {
      if (first !== start) {
        return false;
      }
      sampled += 1;
      if (input[start] !== ":") {
        const field = sseFieldAt(input, start);
        if (!field) {
          return false;
        }
        hasData ||= field === "data";
      }
    }

    const newline = input.indexOf("\n", first);
    if (newline < 0) {
      break;
    }
    start = newline + 1;
  }

  return hasData;
};

interface SseEventBlock {
  lineNumber: number;
  event?: string;
  id?: string;
  retry?: string;
  data: string[];
}

const digitsPattern = /^[0-9]+$/;

export interface SseRecordReader {
  /** Takes one line without its terminator; returns the Record a blank line dispatches. */
  pushLine: (line: string, lineNumber: number) => FullJsonlRecord | null;
  /**
   * Dispatches the event still open at end of input. A live stream discards
   * it, but captured logs often lack the final blank line, and dropping the
   * last event would hide input.
   */
  finish: () => FullJsonlRecord | null;
}

/**
 * Assembles WHATWG Server-Sent Events into Records. Each Record is an object
 * holding the `event`, `id`, and `retry` fields its own block sets, plus the
 * joined `data` string, which goes through the usual Stringified JSON
 * expansion. The Record id and line number come from the block's first line.
 */
export const createSseRecordReader = (options: ParseOptions = {}): SseRecordReader => {
  const maxDepth = resolveMaxDepth(options.maxDepth);
  let block: SseEventBlock | null = null;
  let isFirstLine = true;

  const dispatch = () => {
    const current = block;
    block = null;
    if (!current || current.data.length === 0) {
      return null;
    }

    const entries: Record<string, LosslessJsonValue> = {};
    if (current.event !== undefined) entries.event = current.event;
    if (current.id !== undefined) entries.id = current.id;
    if (current.retry !== undefined) entries.retry = current.retry;
    entries.data = current.data.join("\n");
    return createFullJsonlRecord({ type: "object", entries }, current.lineNumber, maxDepth);
  };

  const pushLine = (rawLine: string, lineNumber: number) => {
    const line = isFirstLine && rawLine.startsWith("\uFEFF") ? rawLine.slice(1) : rawLine;
    isFirstLine = false;
    if (line === "") {
      return dispatch();
    }

    block ??= { lineNumber, data: [] };
    if (line.startsWith(":")) {
      return null;
    }

    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    const rawValue = colon < 0 ? "" : line.slice(colon + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
    switch (field) {
      case "data":
        block.data.push(value);
        break;
      case "event":
        block.event = value;
        break;
      case "id":
        if (!value.includes("\0")) block.id = value;
        break;
      case "retry":
        if (digitsPattern.test(value)) block.retry = value;
        break;
    }
    return null;
  };

  return { pushLine, finish: dispatch };
};

export const parseSseRecords = (input: string, options: ParseOptions = {}) => {
  const reader = createSseRecordReader(options);
  const records: FullJsonlRecord[] = [];
  for (const [index, line] of input.split(/\r?\n/).entries()) {
    const record = reader.pushLine(line, index + 1);
    if (record) records.push(record);
  }
  const last = reader.finish();
  if (last) records.push(last);
  return records;
};
