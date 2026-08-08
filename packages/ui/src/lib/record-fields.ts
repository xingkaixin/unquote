import type { JsonNode } from "@unquote/core";
import type { TreePathSegment } from "./path-codec";

// record-insight also strips dots (field keys rarely contain them); file-overview
// does not. Default matches record-insight; overview passes stripDots: false.
export const normalizeKey = (key: string, stripDots = true) =>
  key.replace(stripDots ? /[-_\s.]/g : /[-_\s]/g, "").toLowerCase();

export const getPrimitiveValue = (node: JsonNode): string | null => {
  if (node.kind === "object" || node.kind === "array") {
    return null;
  }

  if (node.kind === "number") {
    return node.rawValue ?? String(node.value);
  }
  return node.kind === "string" ? node.value : String(node.value);
};

// A bare `name` field denotes a tool/function when its path passes through a
// tool/function-ish segment.
export const isToolContext = (segments: readonly TreePathSegment[]) =>
  segments.some((segment) => /tool|function/i.test(segment.value));
