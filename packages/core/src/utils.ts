import type { JsonKind, MaterializeOptions } from "./types.js";
import { materializeLosslessValue, parseLosslessJson } from "./lossless-json.js";

export const DEFAULT_MAX_DEPTH = 100;

export const getJsonKind = (value: unknown): JsonKind => {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  switch (typeof value) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    default:
      return "object";
  }
};

export const parseJson = (input: string, options: MaterializeOptions = {}) =>
  materializeLosslessValue(parseLosslessJson(input), options);

const isHighSurrogate = (codeUnit: number) => codeUnit >= 0xd800 && codeUnit <= 0xdbff;
const isLowSurrogate = (codeUnit: number) => codeUnit >= 0xdc00 && codeUnit <= 0xdfff;

export const truncateAtCodePointBoundary = (value: string, maxLength: number) => {
  if (value.length <= maxLength) {
    return value;
  }
  if (maxLength <= 0) {
    return "";
  }

  const splitsSurrogatePair =
    isHighSurrogate(value.charCodeAt(maxLength - 1)) && isLowSurrogate(value.charCodeAt(maxLength));
  return value.slice(0, splitsSurrogatePair ? maxLength - 1 : maxLength);
};

export interface JsonlProbeResult {
  sampledLines: number;
  parsableLines: number;
  isLikelyJsonl: boolean;
}

/**
 * Samples the first non-empty lines and checks whether each parses as JSON.
 * Single source of truth for "does this look like JSONL" — shared by
 * `detectFormat` and the UI's streaming-channel decision, so the verdict is
 * the same on both sides. Probing only picks the channel; final correctness
 * is guaranteed by parsing itself.
 */
export const probeJsonl = (input: string, sampleLimit = 8): JsonlProbeResult => {
  const lines: string[] = [];
  let start = 0;

  // charCodeAt scan instead of split: avoids copying the whole (possibly
  // huge) input just to look at the first few lines. Handles \r\n via the
  // trailing-\r check.
  for (let index = 0; index <= input.length && lines.length < sampleLimit; index += 1) {
    if (index < input.length && input.charCodeAt(index) !== 10) {
      continue;
    }

    const end = index > start && input.charCodeAt(index - 1) === 13 ? index - 1 : index;
    const line = input.slice(start, end).trim();
    if (line) {
      lines.push(line);
    }
    start = index + 1;
  }

  let parsableLines = 0;
  for (const line of lines) {
    try {
      parseLosslessJson(line);
      parsableLines += 1;
    } catch {
      // keep counting: parsableLines reports how many sampled lines parse
    }
  }

  return {
    sampledLines: lines.length,
    parsableLines,
    isLikelyJsonl: lines.length >= 2 && parsableLines === lines.length,
  };
};
