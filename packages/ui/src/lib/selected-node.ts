import type { JsonNode, JsonlRecord } from "@unquote/core";
import { stringifyJsonNodeWithLimits } from "@unquote/core";
import { isArrayElementPath } from "./path-codec";
import { copyBytesLimit } from "./record-export";
import { resolveTreePath } from "./tree-path";
import type { SelectedPath } from "./workspace-selection";

export const inspectorNodeLimit = 2000;
export const inspectorCharLimit = 20_000;

type SelectedNodeCopy = { kind: "available"; format: () => string } | { kind: "blocked" };

export type SelectedNodeProjection =
  | { kind: "empty"; copy: { kind: "blocked" } }
  | { kind: "loading"; selection: SelectedPath; copy: { kind: "blocked" } }
  | { kind: "too-large"; selection: SelectedPath; copy: { kind: "blocked" } }
  | {
      kind: "value";
      selection: SelectedPath;
      text: string;
      truncated: boolean;
      copy: SelectedNodeCopy;
    };

const textEncoder = new TextEncoder();

const selectionPrefix = (selection: SelectedPath) =>
  selection.rawKey === "$" || isArrayElementPath(selection.pathText)
    ? ""
    : `${JSON.stringify(selection.rawKey)}: `;

const serializeSelectionNode = (node: JsonNode, maxBytes: number, maxCharacters?: number) =>
  stringifyJsonNodeWithLimits(
    node,
    {
      maxBytes,
      maxNodes: inspectorNodeLimit,
      ...(maxCharacters === undefined ? {} : { maxCharacters }),
    },
    { indent: 2 },
  );

const formatSelectionCopy = (prefix: string, node: JsonNode, maxBytes: number) => {
  const serialized = serializeSelectionNode(node, maxBytes);
  if (!serialized.complete || serialized.byteLimitExceeded || serialized.nodeLimitExceeded) {
    throw new RangeError("Selected node exceeds its copy budget");
  }
  return prefix + serialized.text;
};

const projectResolvedNode = (selection: SelectedPath, node: JsonNode): SelectedNodeProjection => {
  const prefix = selectionPrefix(selection);
  const prefixBytes = textEncoder.encode(prefix).byteLength;
  const prefixBlocked = prefixBytes > copyBytesLimit;
  const remainingBytes = Math.max(0, copyBytesLimit - prefixBytes);
  const serialized = serializeSelectionNode(node, remainingBytes, inspectorCharLimit);

  if (serialized.nodeLimitExceeded) {
    return { kind: "too-large", selection, copy: { kind: "blocked" } };
  }

  const copyBlocked = prefixBlocked || serialized.byteLimitExceeded || !serialized.complete;
  const format = serialized.characterLimitExceeded
    ? () => formatSelectionCopy(prefix, node, remainingBytes)
    : () => prefix + serialized.text;

  return {
    kind: "value",
    selection,
    text: serialized.text,
    truncated: serialized.characterLimitExceeded,
    copy: copyBlocked ? { kind: "blocked" } : { kind: "available", format },
  };
};

export const projectSelectedNode = (
  record: JsonlRecord | null,
  selection: SelectedPath | null,
): SelectedNodeProjection => {
  if (!record || !selection || selection.recordId !== record.id) {
    return { kind: "empty", copy: { kind: "blocked" } };
  }
  if (record.status === "preview") {
    return { kind: "loading", selection, copy: { kind: "blocked" } };
  }
  if (record.status === "failed") {
    return { kind: "empty", copy: { kind: "blocked" } };
  }

  const resolved = resolveTreePath([record], selection.pathText, record.id);
  return resolved.ok
    ? projectResolvedNode(selection, resolved.target.node)
    : { kind: "empty", copy: { kind: "blocked" } };
};
