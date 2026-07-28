import type { JsonNode, JsonlRecord } from "@unquote/core";
import { hasJsonNodeChildren, isParsed, isStringifiedNode } from "@unquote/core";
import { formatJsonPath, formatJqSelector, parseTreePath } from "./path-codec";
import type { TreePathSegment } from "./path-codec";

export type NodeSourceState = "source" | "stringified" | "inside-stringified";

export interface ResolvedTreePath {
  recordId: string;
  recordLine: number;
  node: JsonNode;
  path: string[];
  pathText: string;
  jsonPath: string;
  jqPath: string;
  rawKey: string;
  kind: JsonNode["kind"];
  sourceState: NodeSourceState;
  stringifiedPathChain: string[];
  sourceLine?: number;
}

export type ResolveTreePathResult =
  | { ok: true; target: ResolvedTreePath }
  | { ok: false; reason: "invalid" | "not-found" };

export interface TreePathMatch {
  recordId: string;
  pathText: string;
}

export type ResolveTreePathMatchesResult =
  | { ok: true; targets: TreePathMatch[] }
  | { ok: false; reason: "invalid" | "not-found" };

const getRecordSearchOrder = (records: JsonlRecord[], preferredRecordId?: string) => {
  if (!preferredRecordId) {
    return records;
  }

  const preferred = records.filter((record) => record.id === preferredRecordId);
  return preferred.concat(records.filter((record) => record.id !== preferredRecordId));
};

const createResolvedTreePath = (
  record: JsonlRecord,
  node: JsonNode,
  pathSegments: TreePathSegment[],
  stringifiedPathChain: string[],
): ResolvedTreePath => {
  const jsonPath = formatJsonPath(pathSegments);
  const jqPath = formatJqSelector(pathSegments);
  const sourceState: NodeSourceState = isStringifiedNode(node)
    ? "stringified"
    : stringifiedPathChain.length > 0
      ? "inside-stringified"
      : "source";
  const path = ["$", ...pathSegments.map((segment) => segment.value)];

  return {
    recordId: record.id,
    recordLine: record.lineNumber,
    node,
    path,
    pathText: jsonPath,
    jsonPath,
    jqPath,
    rawKey: pathSegments.at(-1)?.value ?? "$",
    kind: node.kind,
    sourceState,
    stringifiedPathChain: [...stringifiedPathChain],
    sourceLine: record.lineNumber,
  };
};

const findPathNodeInRecord = (
  record: JsonlRecord,
  requestedSegments: TreePathSegment[],
  onStep?: (node: JsonNode, segment: TreePathSegment) => void,
): JsonNode | null => {
  if (!isParsed(record)) {
    return null;
  }

  let node = record.node;

  for (const requested of requestedSegments) {
    if (!hasJsonNodeChildren(node)) {
      return null;
    }

    if (node.kind === "array") {
      if (requested.kind !== "index") {
        return null;
      }

      const index = Number(requested.value);
      if (!Number.isSafeInteger(index)) {
        return null;
      }

      const child = node.children[index];
      if (!child) {
        return null;
      }

      node = child;
      onStep?.(node, { kind: "index", value: String(index) });
    } else {
      if (requested.kind !== "key") {
        return null;
      }

      // Own-property check: a path segment such as `constructor` would
      // otherwise resolve to an inherited member of the children map.
      const child = Object.hasOwn(node.children, requested.value)
        ? node.children[requested.value]
        : undefined;
      if (!child) {
        return null;
      }

      node = child;
      onStep?.(node, requested);
    }
  }

  return node;
};

const resolvePathInRecord = (
  record: JsonlRecord,
  requestedSegments: TreePathSegment[],
): ResolvedTreePath | null => {
  const actualSegments: TreePathSegment[] = [];
  const stringifiedPathChain =
    isParsed(record) && isStringifiedNode(record.node) ? [formatJsonPath(actualSegments)] : [];
  const node = findPathNodeInRecord(record, requestedSegments, (resolvedNode, segment) => {
    actualSegments.push(segment);
    if (isStringifiedNode(resolvedNode)) {
      stringifiedPathChain.push(formatJsonPath(actualSegments));
    }
  });
  if (!node) {
    return null;
  }

  return createResolvedTreePath(record, node, actualSegments, stringifiedPathChain);
};

export const resolveTreePath = (
  records: JsonlRecord[],
  selector: string,
  preferredRecordId?: string,
): ResolveTreePathResult => {
  const requestedSegments = parseTreePath(selector);
  if (!requestedSegments) {
    return { ok: false, reason: "invalid" };
  }

  for (const record of getRecordSearchOrder(records, preferredRecordId)) {
    const target = resolvePathInRecord(record, requestedSegments);
    if (target) {
      return { ok: true, target };
    }
  }

  return { ok: false, reason: "not-found" };
};

export const resolveTreePathMatches = (
  records: JsonlRecord[],
  selector: string,
): ResolveTreePathMatchesResult => {
  const requestedSegments = parseTreePath(selector);
  if (!requestedSegments) {
    return { ok: false, reason: "invalid" };
  }

  const pathText = formatJsonPath(requestedSegments);
  const targets: TreePathMatch[] = [];
  for (const record of records) {
    if (findPathNodeInRecord(record, requestedSegments)) {
      targets.push({ recordId: record.id, pathText });
    }
  }

  return targets.length > 0 ? { ok: true, targets } : { ok: false, reason: "not-found" };
};
