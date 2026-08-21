import type { JsonNode, JsonlRecord } from "@unquote/core";
import { hasJsonNodeChildren, isParsed, isStringifiedNode } from "@unquote/core";
import type { RecordInsight } from "./record-insight";
import type { SearchResultSet } from "./record-search";

export type RecordFilterMode =
  | "all"
  | "matches"
  | "errors"
  | "nested"
  | "tool"
  | "message"
  | "events";

export type NestedFilterScope = "all-levels" | "top-level";

const containsStringifiedNode = (node: JsonNode): boolean => {
  if (isStringifiedNode(node)) {
    return true;
  }

  if (!hasJsonNodeChildren(node)) {
    return false;
  }

  return Array.isArray(node.children)
    ? node.children.some(containsStringifiedNode)
    : Object.values(node.children).some(containsStringifiedNode);
};

export const recordContainsStringifiedJson = (record: JsonlRecord) =>
  record.status === "preview" && record.preview
    ? (record.preview.nestedFieldKeys?.length ?? 0) > 0
    : isParsed(record) && containsStringifiedNode(record.node);

const filterMatchedRecords = (records: JsonlRecord[], lineNumbers: Float64Array) => {
  const matchedRecords: JsonlRecord[] = [];
  let matchIndex = 0;
  for (const record of records) {
    while (matchIndex < lineNumbers.length && lineNumbers[matchIndex]! < record.lineNumber) {
      matchIndex += 1;
    }
    if (lineNumbers[matchIndex] === record.lineNumber) {
      matchedRecords.push(record);
    }
  }
  return matchedRecords;
};

export const filterRecords = (
  records: JsonlRecord[],
  mode: RecordFilterMode,
  searchResult: SearchResultSet | null,
  insights: ReadonlyMap<string, RecordInsight> = new Map(),
) => {
  if (mode === "all") {
    return records;
  }

  if (mode === "matches") {
    return filterMatchedRecords(records, searchResult?.matchLineNumbers ?? new Float64Array());
  }

  if (mode === "errors") {
    return records.filter(
      (record) => !isParsed(record) || insights.get(record.id)?.kind === "error",
    );
  }

  if (mode === "nested") {
    return records.filter((record) => (insights.get(record.id)?.nestedJsonCount ?? 0) > 0);
  }

  if (mode === "tool") {
    return records.filter((record) => insights.get(record.id)?.kind === "tool");
  }

  if (mode === "message") {
    return records.filter((record) => insights.get(record.id)?.kind === "message");
  }

  if (mode === "events") {
    return records.filter((record) => insights.get(record.id)?.kind === "event");
  }

  return records;
};
