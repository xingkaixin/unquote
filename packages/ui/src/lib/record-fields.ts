import type { JsonlRecordPreviewFieldValue, JsonNode } from "@unquote/core";
import type { TreePathSegment } from "./path-codec";

// record-insight also strips dots (field keys rarely contain them); file-overview
// does not. Default matches record-insight; overview passes stripDots: false.
export const normalizeKey = (key: string, stripDots = true) =>
  key.replace(stripDots ? /[-_\s.]/g : /[-_\s]/g, "").toLowerCase();

export const getPrimitiveValue = (
  source: JsonNode | JsonlRecordPreviewFieldValue,
): string | null => {
  if (source === null || typeof source !== "object") {
    return String(source);
  }
  if ("type" in source) {
    return source.rawValue;
  }
  if (source.kind === "object" || source.kind === "array") {
    return null;
  }

  if (source.kind === "number") {
    return source.rawValue ?? String(source.value);
  }
  return source.kind === "string" ? source.value : String(source.value);
};

// A bare `name` field denotes a tool/function when its path passes through a
// tool/function-ish segment.
export const isToolContext = (segments: readonly TreePathSegment[]) =>
  segments.some((segment) => /tool|function/i.test(segment.value));
