import type { JsonNode, JsonlRecord } from "@unquote/core";
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

interface RangeScan {
  ranges: TextRange[];
  matched: boolean;
}

/**
 * Scans the whole text so a match past `visibleLength` still counts, but only
 * materializes the ranges the UI can highlight. A dense pattern over a
 * megabyte-long value would otherwise allocate one object per match while the
 * view shows a few hundred characters.
 */
const scanRanges = (text: string, pattern: RegExp, visibleLength = text.length): RangeScan => {
  const ranges: TextRange[] = [];
  const clone = new RegExp(
    pattern.source,
    pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
  );
  let match: RegExpExecArray | null;
  while ((match = clone.exec(text)) !== null) {
    const end = match.index + match[0].length;
    if (end > visibleLength) {
      // Later matches end even further out, so no more ranges can become
      // visible and the "text matches at all" fact is already settled.
      return { ranges, matched: true };
    }
    ranges.push({ start: match.index, end });
    if (match[0].length === 0) {
      clone.lastIndex++;
    }
  }
  return { ranges, matched: ranges.length > 0 };
};

const addSearchMatch = (
  context: JsonValueWalkContext<unknown>,
  recordId: string,
  pattern: RegExp,
  options: SearchOptions,
  matches: SearchMatch[],
) => {
  const keySegment = context.pathSegments.at(-1);
  const keyRanges = keySegment?.kind === "key" ? scanRanges(keySegment.value, pattern).ranges : [];
  const value = scanRanges(
    formatJsonValueLabel(context),
    pattern,
    getSearchableJsonValueLabelLength(context, maxStringValueLabelLength),
  );
  const pathRanges = options.jq ? scanRanges(context.jsonPath, pattern).ranges : [];

  if (keyRanges.length > 0 || value.matched || pathRanges.length > 0) {
    matches.push({
      recordId,
      pathText: context.jsonPath,
      keyRanges,
      valueRanges: value.ranges,
      pathRanges,
      stringifiedPathChain: [...context.stringifiedChain],
    });
  }
};

const searchNode = (
  node: JsonNode,
  recordId: string,
  pattern: RegExp,
  stringifiedAncestors: string[],
  matches: SearchMatch[],
  options: SearchOptions,
  pathText = "$",
) => {
  walkJsonNode(node, (ctx) => addSearchMatch(ctx, recordId, pattern, options, matches), {
    jsonPath: pathText,
    stringifiedAncestors,
  });
};

export const searchJsonValue = (
  value: unknown,
  recordId: string,
  pattern: RegExp,
  options: SearchOptions,
): SearchMatch[] => {
  const matches: SearchMatch[] = [];
  walkRawJsonValue(value, (ctx) => addSearchMatch(ctx, recordId, pattern, options, matches));
  return matches;
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
): SearchMatch[] | null =>
  measurePerfFn("search:memory", () => {
    const pattern = buildSearchPattern(query, options);
    if (!pattern) {
      return null;
    }

    const matches: SearchMatch[] = [];
    for (const record of records) {
      for (const match of searchRecord(record, pattern, options)) {
        matches.push(match);
      }
    }

    return matches;
  });

export const searchRecord = (
  record: JsonlRecord,
  pattern: RegExp,
  options: SearchOptions,
): SearchMatch[] => {
  if (!isParsed(record)) {
    return [];
  }

  const matches: SearchMatch[] = [];
  searchNode(record.node, record.id, pattern, [], matches, options);
  return matches;
};
