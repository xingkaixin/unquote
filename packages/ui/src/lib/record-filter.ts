import type { JsonNode, JsonlRecord } from "@unquote/core";
import { hasJsonNodeChildren, isParsed, isStringifiedNode } from "@unquote/core";
import type { RecordInsight } from "./record-insight";
import type { SearchMatch } from "./record-search";

export type RecordFilterMode =
  | "all"
  | "matches"
  | "errors"
  | "nested"
  | "tool"
  | "message"
  | "events";

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

const recordContainsStringifiedJson = (record: JsonlRecord) =>
  record.status === "preview" && record.preview
    ? (record.preview.nestedFieldKeys?.length ?? 0) > 0
    : isParsed(record) && containsStringifiedNode(record.node);

export const filterRecords = (
  records: JsonlRecord[],
  mode: RecordFilterMode,
  matches: SearchMatch[] | null,
  insights: ReadonlyMap<string, RecordInsight> = new Map(),
) => {
  if (mode === "all") {
    return records;
  }

  if (mode === "matches") {
    const matchedRecordIds = new Set(matches?.map((match) => match.recordId) ?? []);
    return records.filter((record) => matchedRecordIds.has(record.id));
  }

  if (mode === "errors") {
    return records.filter(
      (record) => !isParsed(record) || insights.get(record.id)?.kind === "error",
    );
  }

  if (mode === "nested") {
    return records.filter(recordContainsStringifiedJson);
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
