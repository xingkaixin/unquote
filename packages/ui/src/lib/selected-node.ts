import type { JsonNode, JsonlRecord } from "@unquote/core";
import { hasJsonNodeChildren } from "@unquote/core";
import { isArrayElementPath } from "./path-codec";
import { resolveTreePath } from "./tree-path";
import type { SelectedPath } from "./workspace-selection";

export const inspectorNodeLimit = 2000;
export const inspectorCharLimit = 20_000;

export interface SelectedNodeResolution {
  node: JsonNode;
  rawKey: string;
}

export const resolveSelectedNode = (
  record: JsonlRecord,
  selection: SelectedPath,
): SelectedNodeResolution | null => {
  const resolved = resolveTreePath([record], selection.pathText, record.id);
  if (!resolved.ok) {
    return null;
  }

  return { node: resolved.target.node, rawKey: resolved.target.rawKey };
};

export const formatSelectionCopy = (selection: SelectedPath, value: unknown) => {
  const valueText = JSON.stringify(value, null, 2);
  if (selection.rawKey === "$" || isArrayElementPath(selection.pathText)) {
    return valueText;
  }

  return `${JSON.stringify(selection.rawKey)}: ${valueText}`;
};

export const isNodeWithinInspectorBudget = (node: JsonNode) => {
  const pending: JsonNode[] = [node];
  let visited = 0;

  while (pending.length > 0) {
    visited += 1;
    const current = pending.pop()!;
    if (!hasJsonNodeChildren(current)) {
      continue;
    }

    const children = Array.isArray(current.children)
      ? current.children
      : Object.values(current.children);
    for (const child of children) {
      pending.push(child);
      if (visited + pending.length > inspectorNodeLimit) {
        return false;
      }
    }
  }

  return true;
};
