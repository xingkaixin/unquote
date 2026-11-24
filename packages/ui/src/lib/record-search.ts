import type { JsonlRecord, JsonNode } from "@unquote/core";
import {
  DEFAULT_MAX_DEPTH,
  hasJsonNodeChildren,
  isParsed,
  isStringifiedNode,
  mightBeStringifiedJson,
  parseJsonlRecordLine,
} from "@unquote/core";
import {
  formatJsonValueLabel,
  getSearchableJsonValueLabelLength,
  maxStringValueLabelLength,
  walkJsonNode,
} from "./json-walk";
import type { JsonWalkContext } from "./json-walk";
import { appendJsonPathSegment, formatJsonPath, parseTreePath } from "./path-codec";
import type { TreePathSegment } from "./path-codec";
import { measurePerfFn } from "./perf";

export interface TextRange {
  start: number;
  end: number;
}

export interface SearchMatch {
  recordId: string;
  pathText: string;
  keyRanges: TextRange[];
  valueRanges: TextRange[];
  pathRanges: TextRange[];
  stringifiedPathChain: string[];
}

export type SearchSyntax = "text" | "regex" | "jq";

export interface SearchOptions {
  syntax: SearchSyntax | "path";
  caseSensitive: boolean;
}

export interface SearchResultWindow {
  matchIndexes: Float64Array;
  matches: SearchMatch[];
}

export interface SearchResultSet {
  total: number;
  matchLineNumbers: Float64Array;
  window: SearchResultWindow;
}

export const searchResultWindowSize = 128;

export interface SearchResultCollector {
  addRecord: (record: JsonlRecord) => void;
  addRawJsonLine: (line: string, lineNumber: number) => void;
  finish: () => SearchResultSet;
}

interface InternalSearchResultCollector extends SearchResultCollector {
  addContext: (context: JsonWalkContext, recordId: string, lineNumber: number) => void;
}

/**
 * A materialized hit still scans only the visible label for ranges. Match
 * existence was established separately against the complete value.
 */
const scanRanges = (text: string, pattern: RegExp, visibleLength = text.length): TextRange[] => {
  const ranges: TextRange[] = [];
  const rangePattern = new RegExp(
    pattern.source,
    pattern.global ? pattern.flags : `${pattern.flags}g`,
  );
  let match: RegExpExecArray | null;
  while ((match = rangePattern.exec(text)) !== null) {
    const end = match.index + match[0].length;
    if (end > visibleLength) {
      return ranges;
    }
    ranges.push({ start: match.index, end });
    if (match[0].length === 0) {
      rangePattern.lastIndex++;
    }
  }
  return ranges;
};

export const normalizeSearchWindowIndexes = (indexes?: ArrayLike<number>) => {
  if (!indexes) {
    return null;
  }

  const normalized = new Set<number>();
  for (let index = 0; index < indexes.length; index += 1) {
    const value = indexes[index];
    if (Number.isSafeInteger(value) && value !== undefined && value >= 0) {
      normalized.add(value);
      if (normalized.size === searchResultWindowSize) {
        break;
      }
    }
  }

  return new Set([...normalized].sort((left, right) => left - right));
};

const containerLabelOnlyPattern = /^[\d[\]{}]+$/;

const numberQueryCharsPattern = /^[0-9.\-+eE]+$/;

const isAsciiOnly = (value: string) => {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 0x7f) {
      return false;
    }
  }
  return true;
};

const unsafeRawProbePattern = /[^\x20-\x7e]|["\\/]/;

// oxlint-disable-next-line no-control-regex -- Matches JSON-escapable control characters, quotes, backslashes, and surrogates.
const jsonEscapablePattern = /[\x00-\x1f"\\\ud800-\udfff]/;

// oxlint-disable-next-line no-control-regex -- Matches control characters and surrogates whose JSON.stringify form introduces letters or hex digits.
const controlOrSurrogatePattern = /[\x00-\x1f\ud800-\udfff]/;

const hasJsonEscapableChar = (value: string) => jsonEscapablePattern.test(value);

type RawJsonValue =
  | string
  | number
  | boolean
  | null
  | RawJsonValue[]
  | { [key: string]: RawJsonValue };

const parseRawJsonValue = (input: string): RawJsonValue =>
  // SAFETY: JSON.parse returns only primitives, arrays, and plain objects matching RawJsonValue.
  JSON.parse(input) as RawJsonValue;

const fastTrim = (value: string) => {
  const length = value.length;
  if (length === 0) {
    return "";
  }
  const first = value.charCodeAt(0);
  const last = value.charCodeAt(length - 1);
  if (first > 32 && first < 127 && last > 32 && last < 127) {
    return value;
  }
  return value.trim();
};

const matchExactPath = (root: JsonNode, segments: readonly TreePathSegment[]) => {
  let node: JsonNode = root;
  let path = "$";
  const chain: string[] = [];
  if (isStringifiedNode(node)) chain.push(path);

  for (const segment of segments) {
    if (!hasJsonNodeChildren(node)) return null;
    if (segment.kind === "index") {
      const next = node.kind === "array" ? node.children[Number(segment.value)] : undefined;
      if (!next) return null;
      node = next;
    } else {
      if (node.kind !== "object" || !Object.hasOwn(node.children, segment.value)) return null;
      node = node.children[segment.value]!;
    }
    path = appendJsonPathSegment(path, segment);
    if (isStringifiedNode(node)) chain.push(path);
  }

  return { pathText: path, stringifiedPathChain: chain };
};

const createCollector = (
  pattern: RegExp,
  options: SearchOptions,
  windowIndexes?: ArrayLike<number>,
  query?: string,
): InternalSearchResultCollector => {
  const testPattern = new RegExp(pattern.source, pattern.flags.replace("g", ""));
  const usePlainSubstring = options.syntax === "text" && !!query;
  const minAsciiQueryLength =
    usePlainSubstring && !options.caseSensitive && isAsciiOnly(query) ? query.length : 0;
  const matchesPattern =
    usePlainSubstring && options.caseSensitive
      ? (text: string) => text.includes(query)
      : minAsciiQueryLength > 0
        ? (text: string) => text.length >= minAsciiQueryLength && testPattern.test(text)
        : testPattern.sticky
          ? (text: string) => {
              testPattern.lastIndex = 0;
              return testPattern.test(text);
            }
          : (text: string) => testPattern.test(text);
  const plainStringQuerySafe = usePlainSubstring && !hasJsonEscapableChar(query);
  const canMatchContainerLabel = !usePlainSubstring || containerLabelOnlyPattern.test(query);
  const canMatchNumber = !usePlainSubstring || numberQueryCharsPattern.test(query);
  const plainAsciiProbeSafe =
    usePlainSubstring && !unsafeRawProbePattern.test(query) && !canMatchContainerLabel;
  const matchesNull = options.syntax !== "path" && matchesPattern("null");
  const matchesTrue = options.syntax !== "path" && matchesPattern("true");
  const matchesFalse = options.syntax !== "path" && matchesPattern("false");
  const canCountRawLines = usePlainSubstring && !canMatchNumber;
  const exactPathSegments =
    options.syntax === "path" && query !== undefined ? parseTreePath(query) : null;
  const requestedIndexes = normalizeSearchWindowIndexes(windowIndexes);
  const matchLineNumbers: number[] = [];
  const materializedIndexes: number[] = [];
  const matches: SearchMatch[] = [];

  const matchesRawString = (value: string) => {
    if (plainStringQuerySafe) {
      if (matchesPattern(value)) {
        return true;
      }
      if (hasJsonEscapableChar(value)) {
        return matchesPattern(JSON.stringify(value));
      }
      return false;
    }
    return matchesPattern(JSON.stringify(value));
  };

  const matchesKey = (keyText: string | null) => Boolean(keyText && matchesPattern(keyText));

  const countRawValueMatches = (
    value: RawJsonValue,
    keyText: string | null,
    depth: number,
    pendingCounts: { count: number },
  ): void => {
    if (typeof value === "string") {
      if (
        plainAsciiProbeSafe &&
        !matchesPattern(value) &&
        !value.includes("\\u") &&
        !controlOrSurrogatePattern.test(value)
      ) {
        if (matchesKey(keyText)) {
          pendingCounts.count += 1;
        }
        return;
      }

      if (depth <= DEFAULT_MAX_DEPTH) {
        let current = value;
        let hasParsedLayer = false;
        while (true) {
          const trimmed = fastTrim(current);
          if (!trimmed || !mightBeStringifiedJson(trimmed)) {
            break;
          }
          try {
            const parsed = parseRawJsonValue(trimmed);
            hasParsedLayer = true;
            if (typeof parsed !== "string" || parsed === current) {
              countRawValueMatches(parsed, keyText, depth, pendingCounts);
              return;
            }
            current = parsed;
          } catch {
            break;
          }
        }
        if (hasParsedLayer) {
          if (matchesKey(keyText) || matchesRawString(current)) {
            pendingCounts.count += 1;
          }
          return;
        }
      }

      if (matchesKey(keyText) || matchesRawString(value)) {
        pendingCounts.count += 1;
      }
      return;
    }

    if (value === null) {
      if (matchesKey(keyText) || matchesNull) {
        pendingCounts.count += 1;
      }
      return;
    }

    if (typeof value === "boolean") {
      if (matchesKey(keyText) || (value ? matchesTrue : matchesFalse)) {
        pendingCounts.count += 1;
      }
      return;
    }

    if (typeof value === "number") {
      if (matchesKey(keyText)) {
        pendingCounts.count += 1;
      }
      return;
    }

    if (Array.isArray(value)) {
      if (matchesKey(keyText) || (canMatchContainerLabel && matchesPattern(`[${value.length}]`))) {
        pendingCounts.count += 1;
      }
      if (depth < DEFAULT_MAX_DEPTH) {
        for (let index = 0; index < value.length; index += 1) {
          countRawValueMatches(value[index]!, null, depth + 1, pendingCounts);
        }
      }
      return;
    }

    if (canMatchContainerLabel) {
      const keys = Object.keys(value);
      if (matchesKey(keyText) || matchesPattern(`{${keys.length}}`)) {
        pendingCounts.count += 1;
      }
      if (depth < DEFAULT_MAX_DEPTH) {
        for (let index = 0; index < keys.length; index += 1) {
          const childKey = keys[index]!;
          countRawValueMatches(value[childKey]!, childKey, depth + 1, pendingCounts);
        }
      }
      return;
    }

    if (matchesKey(keyText)) {
      pendingCounts.count += 1;
    }
    if (depth < DEFAULT_MAX_DEPTH) {
      for (const childKey in value) {
        countRawValueMatches(value[childKey]!, childKey, depth + 1, pendingCounts);
      }
    }
  };

  const recordMatch = (lineNumber: number, createMatch: () => SearchMatch) => {
    const matchIndex = matchLineNumbers.length;
    matchLineNumbers.push(lineNumber);
    const shouldMaterialize = requestedIndexes
      ? requestedIndexes.has(matchIndex)
      : matchIndex < searchResultWindowSize;
    if (!shouldMaterialize) {
      return;
    }

    materializedIndexes.push(matchIndex);
    matches.push(createMatch());
  };

  const addContext = (context: JsonWalkContext, recordId: string, lineNumber: number) => {
    const keySegment = context.pathSegments.at(-1);
    const keyText = keySegment?.kind === "key" ? keySegment.value : null;
    const pathOnly = options.syntax === "path";
    const keyMatched = !pathOnly && matchesKey(keyText);

    let valueText: string | undefined;
    let valueMatched = false;
    if (!pathOnly) {
      if (context.kind === "object" || context.kind === "array") {
        if (canMatchContainerLabel) {
          valueText = formatJsonValueLabel(context);
          valueMatched = matchesPattern(valueText);
        }
      } else if (
        context.kind === "string" &&
        plainStringQuerySafe &&
        (context.valueLength === undefined || context.valueLength === context.value.length)
      ) {
        valueMatched = matchesPattern(context.value);
        if (!valueMatched && hasJsonEscapableChar(context.value)) {
          valueText = formatJsonValueLabel(context);
          valueMatched = matchesPattern(valueText);
        }
      } else {
        valueText = formatJsonValueLabel(context);
        valueMatched = matchesPattern(valueText);
      }
    }

    const pathMatched = (pathOnly || options.syntax === "jq") && matchesPattern(context.jsonPath);
    if (!keyMatched && !valueMatched && !pathMatched) {
      return;
    }

    recordMatch(lineNumber, () => {
      const resolvedPath = context.resolvePath?.();
      const pathText = resolvedPath ? resolvedPath.jsonPath : context.jsonPath;
      const formatted = valueMatched ? (valueText ?? formatJsonValueLabel(context)) : "";
      return {
        recordId,
        pathText,
        keyRanges: keyMatched && keyText ? scanRanges(keyText, pattern) : [],
        valueRanges: valueMatched
          ? scanRanges(
              formatted,
              pattern,
              getSearchableJsonValueLabelLength(context, maxStringValueLabelLength),
            )
          : [],
        pathRanges: options.syntax === "jq" ? scanRanges(pathText, pattern) : [],
        stringifiedPathChain: resolvedPath
          ? resolvedPath.stringifiedChain
          : [...context.stringifiedChain],
      };
    });
  };

  const addRecord = (record: JsonlRecord) => {
    if (!isParsed(record)) {
      return;
    }

    if (exactPathSegments) {
      const hit = matchExactPath(record.node, exactPathSegments);
      if (hit) {
        recordMatch(record.lineNumber, () => ({
          recordId: record.id,
          pathText: hit.pathText,
          keyRanges: [],
          valueRanges: [],
          pathRanges: [],
          stringifiedPathChain: hit.stringifiedPathChain,
        }));
      }
      return;
    }

    walkJsonNode(record.node, (context) => addContext(context, record.id, record.lineNumber), {
      jsonPath: "$",
      stringifiedAncestors: [],
      lazyPath: options.syntax === "text" || options.syntax === "regex",
    });
  };

  return {
    addContext,
    addRecord,
    addRawJsonLine(line, lineNumber) {
      if (
        canCountRawLines &&
        !requestedIndexes &&
        matchLineNumbers.length >= searchResultWindowSize
      ) {
        let parsed: RawJsonValue;
        try {
          parsed = parseRawJsonValue(line);
        } catch {
          return;
        }
        const pendingCounts = { count: 0 };
        countRawValueMatches(parsed, null, 0, pendingCounts);
        for (let index = 0; index < pendingCounts.count; index += 1) {
          matchLineNumbers.push(lineNumber);
        }
        return;
      }

      try {
        addRecord(parseJsonlRecordLine(line, lineNumber));
      } catch {
        // Invalid lines have no record tree and therefore cannot produce a search match.
      }
    },
    finish: () => ({
      total: matchLineNumbers.length,
      matchLineNumbers: Float64Array.from(matchLineNumbers),
      window: {
        matchIndexes: Float64Array.from(materializedIndexes),
        matches,
      },
    }),
  };
};

export const createSearchResultCollector = (
  pattern: RegExp,
  options: SearchOptions,
  windowIndexes?: ArrayLike<number>,
  query?: string,
): SearchResultCollector => createCollector(pattern, options, windowIndexes, query);

export const buildSearchPattern = (query: string, options: SearchOptions): RegExp | null => {
  if (!query) {
    return null;
  }

  if (options.syntax === "path") {
    const segments = parseTreePath(query);
    if (!segments) {
      return null;
    }
    const path = formatJsonPath(segments).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^${path}$`, "g");
  }

  const flags = options.caseSensitive ? "g" : "gi";

  if (options.syntax === "regex") {
    try {
      return new RegExp(query, flags);
    } catch {
      return null;
    }
  }

  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped, flags);
};

export const searchRecords = (
  records: JsonlRecord[],
  query: string,
  options: SearchOptions,
  windowIndexes?: ArrayLike<number>,
): SearchResultSet | null =>
  measurePerfFn("search:memory", () => {
    const pattern = buildSearchPattern(query, options);
    if (!pattern) {
      return null;
    }

    const collector = createCollector(pattern, options, windowIndexes, query);
    for (const record of records) {
      collector.addRecord(record);
    }
    return collector.finish();
  });
