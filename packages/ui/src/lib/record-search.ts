import type { JsonlRecord, JsonNode } from "@unquote/core";
import { hasJsonNodeChildren, isParsed, isStringifiedNode } from "@unquote/core";
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

const hasJsonEscapableChar = (value: string) => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x22 || code === 0x5c) {
      return true;
    }
    if (code >= 0xd800 && code <= 0xdfff) {
      if (code <= 0xdbff && index + 1 < value.length) {
        const next = value.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          index += 1;
          continue;
        }
      }
      return true;
    }
  }
  return false;
};

const matchExactPath = (root: JsonNode, segments: readonly TreePathSegment[]) => {
  let node: JsonNode = root;
  let currentPath = "$";
  const stringifiedChain: string[] = [];
  if (isStringifiedNode(node)) {
    stringifiedChain.push(currentPath);
  }

  for (let index = 0; index < segments.length; index += 1) {
    if (!hasJsonNodeChildren(node)) {
      return null;
    }
    const segment = segments[index]!;
    if (segment.kind === "index") {
      if (node.kind !== "array") {
        return null;
      }
      const itemIndex = Number(segment.value);
      if (itemIndex < 0 || itemIndex >= node.children.length) {
        return null;
      }
      node = node.children[itemIndex]!;
    } else {
      if (node.kind !== "object" || !Object.hasOwn(node.children, segment.value)) {
        return null;
      }
      node = node.children[segment.value]!;
    }
    currentPath = appendJsonPathSegment(currentPath, segment);
    if (isStringifiedNode(node)) {
      stringifiedChain.push(currentPath);
    }
  }

  return { pathText: currentPath, stringifiedPathChain: stringifiedChain };
};

const createCollector = (
  pattern: RegExp,
  options: SearchOptions,
  windowIndexes?: ArrayLike<number>,
  query?: string,
): InternalSearchResultCollector => {
  const testPattern = new RegExp(pattern.source, pattern.flags.replace("g", ""));
  const usePlainSubstring = options.syntax === "text" && query !== undefined && query.length > 0;
  const matchesPattern =
    usePlainSubstring && options.caseSensitive
      ? (text: string) => text.includes(query)
      : testPattern.sticky
        ? (text: string) => {
            testPattern.lastIndex = 0;
            return testPattern.test(text);
          }
        : (text: string) => testPattern.test(text);
  const plainStringQuerySafe = usePlainSubstring && !hasJsonEscapableChar(query);
  const canMatchContainerLabel = !usePlainSubstring || containerLabelOnlyPattern.test(query);
  const exactPathSegments =
    options.syntax === "path" && query !== undefined ? parseTreePath(query) : null;
  const requestedIndexes = normalizeSearchWindowIndexes(windowIndexes);
  const matchLineNumbers: number[] = [];
  const materializedIndexes: number[] = [];
  const matches: SearchMatch[] = [];

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

  const matchContextValue = (
    context: JsonWalkContext,
  ): { matched: boolean; formatted?: string } => {
    if (context.kind === "object" || context.kind === "array") {
      if (!canMatchContainerLabel) {
        return { matched: false };
      }
      const formatted = formatJsonValueLabel(context);
      return { matched: matchesPattern(formatted), formatted };
    }
    if (context.kind === "string") {
      if (
        plainStringQuerySafe &&
        (context.valueLength === undefined || context.valueLength === context.value.length)
      ) {
        if (matchesPattern(context.value)) {
          return { matched: true };
        }
        if (!hasJsonEscapableChar(context.value)) {
          return { matched: false };
        }
      }
      const formatted = formatJsonValueLabel(context);
      return { matched: matchesPattern(formatted), formatted };
    }
    const formatted =
      context.kind === "null"
        ? "null"
        : context.kind === "boolean"
          ? context.value
            ? "true"
            : "false"
          : typeof context.value === "string"
            ? context.value
            : String(context.value);
    return { matched: matchesPattern(formatted), formatted };
  };

  const addContext = (context: JsonWalkContext, recordId: string, lineNumber: number) => {
    const keySegment = context.pathSegments.at(-1);
    const keyText = keySegment?.kind === "key" ? keySegment.value : null;
    const pathOnly = options.syntax === "path";
    const keyMatched = !pathOnly && keyText ? matchesPattern(keyText) : false;
    const valueResult = pathOnly ? { matched: false } : matchContextValue(context);
    const valueMatched = valueResult.matched;
    const pathMatched = (pathOnly || options.syntax === "jq") && matchesPattern(context.jsonPath);

    if (!keyMatched && !valueMatched && !pathMatched) {
      return;
    }

    recordMatch(lineNumber, () => {
      const valueText = valueMatched
        ? (valueResult.formatted ?? formatJsonValueLabel(context))
        : "";
      return {
        recordId,
        pathText: context.jsonPath,
        keyRanges: keyMatched && keyText ? scanRanges(keyText, pattern) : [],
        valueRanges: valueMatched
          ? scanRanges(
              valueText,
              pattern,
              getSearchableJsonValueLabelLength(context, maxStringValueLabelLength),
            )
          : [],
        pathRanges: options.syntax === "jq" ? scanRanges(context.jsonPath, pattern) : [],
        stringifiedPathChain: [...context.stringifiedChain],
      };
    });
  };

  return {
    addContext,
    addRecord(record) {
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
