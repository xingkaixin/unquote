import type { JsonlRecord } from "@unquote/core";
import { isParsed } from "@unquote/core";
import {
  formatJsonValueLabel,
  getSearchableJsonValueLabelLength,
  maxStringValueLabelLength,
  walkJsonNode,
  walkRawJsonValue,
} from "./json-walk";
import type { JsonValueWalkContext } from "./json-walk";
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

export interface SearchOptions {
  regex: boolean;
  caseSensitive: boolean;
  jq: boolean;
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
  addContext: (
    context: JsonValueWalkContext<unknown>,
    recordId: string,
    lineNumber: number,
  ) => void;
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

const normalizeWindowIndexes = (indexes?: ArrayLike<number>) => {
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

const createCollector = (
  pattern: RegExp,
  options: SearchOptions,
  windowIndexes?: ArrayLike<number>,
): InternalSearchResultCollector => {
  const testPattern = new RegExp(pattern.source, pattern.flags.replace("g", ""));
  const matchesPattern = testPattern.sticky
    ? (text: string) => {
        testPattern.lastIndex = 0;
        return testPattern.test(text);
      }
    : (text: string) => testPattern.test(text);
  const requestedIndexes = normalizeWindowIndexes(windowIndexes);
  const matchLineNumbers: number[] = [];
  const materializedIndexes: number[] = [];
  const matches: SearchMatch[] = [];

  const addContext = (
    context: JsonValueWalkContext<unknown>,
    recordId: string,
    lineNumber: number,
  ) => {
    const keySegment = context.pathSegments.at(-1);
    const keyText = keySegment?.kind === "key" ? keySegment.value : null;
    const valueText = formatJsonValueLabel(context);
    const keyMatched = keyText ? matchesPattern(keyText) : false;
    const valueMatched = matchesPattern(valueText);
    const pathMatched = options.jq && matchesPattern(context.jsonPath);

    if (!keyMatched && !valueMatched && !pathMatched) {
      return;
    }

    const matchIndex = matchLineNumbers.length;
    matchLineNumbers.push(lineNumber);
    const shouldMaterialize = requestedIndexes
      ? requestedIndexes.has(matchIndex)
      : matchIndex < searchResultWindowSize;
    if (!shouldMaterialize) {
      return;
    }

    materializedIndexes.push(matchIndex);
    matches.push({
      recordId,
      pathText: context.jsonPath,
      keyRanges: keyText ? scanRanges(keyText, pattern) : [],
      valueRanges: scanRanges(
        valueText,
        pattern,
        getSearchableJsonValueLabelLength(context, maxStringValueLabelLength),
      ),
      pathRanges: options.jq ? scanRanges(context.jsonPath, pattern) : [],
      stringifiedPathChain: [...context.stringifiedChain],
    });
  };

  return {
    addContext,
    addRecord(record) {
      if (!isParsed(record)) {
        return;
      }

      walkJsonNode(record.node, (context) => addContext(context, record.id, record.lineNumber), {
        jsonPath: "$",
        stringifiedAncestors: [],
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
): SearchResultCollector => createCollector(pattern, options, windowIndexes);

export const searchJsonValue = (
  value: unknown,
  recordId: string,
  pattern: RegExp,
  options: SearchOptions,
  windowIndexes?: ArrayLike<number>,
): SearchResultSet => {
  const collector = createCollector(pattern, options, windowIndexes);
  walkRawJsonValue(value, (context) => collector.addContext(context, recordId, 1));
  return collector.finish();
};

export const buildSearchPattern = (query: string, options: SearchOptions): RegExp | null => {
  if (!query) {
    return null;
  }

  const flags = options.caseSensitive ? "g" : "gi";

  if (options.regex) {
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

    const collector = createCollector(pattern, options, windowIndexes);
    for (const record of records) {
      collector.addRecord(record);
    }
    return collector.finish();
  });
