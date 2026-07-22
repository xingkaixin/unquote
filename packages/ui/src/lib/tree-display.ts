import { isArrayElementPath } from "./path-codec";
import type { TreeRow } from "./tree";

export type DisplayRowKind = "value" | "open" | "close" | "empty" | "collapsed";

export interface DisplayTreeRow {
  id: string;
  source: TreeRow;
  kind: DisplayRowKind;
  depth: number;
  keyLabel: string | null;
  valueText: string;
  comma: boolean;
  showToggle: boolean;
}

const isContainer = (row: TreeRow) => row.kind === "object" || row.kind === "array";

export const getDisplayKeyLabel = (row: TreeRow) => {
  if (row.pathText === "$" || isArrayElementPath(row.pathText)) {
    return null;
  }

  return row.keyLabel;
};

const getContainerOpen = (row: TreeRow) => (row.kind === "array" ? "[" : "{");

const getContainerClose = (row: TreeRow) => (row.kind === "array" ? "]" : "}");

const getEmptyContainer = (row: TreeRow) => (row.kind === "array" ? "[]" : "{}");

export const getCollapsedValue = (row: TreeRow) => {
  const rawString = row.node.rawString;
  if (typeof rawString === "string") {
    return JSON.stringify(rawString);
  }

  return row.valueLabel;
};

export const buildDisplayRows = (rows: TreeRow[]): DisplayTreeRow[] => {
  const displayRows: DisplayTreeRow[] = [];
  const openStack: TreeRow[] = [];

  const closeUntilSiblingScope = (currentDepth: number) => {
    while (openStack.length > 0 && openStack[openStack.length - 1]!.depth >= currentDepth) {
      const source = openStack.pop()!;
      displayRows.push({
        id: `${source.id}:close`,
        source,
        kind: "close",
        depth: source.depth,
        keyLabel: null,
        valueText: getContainerClose(source),
        comma: source.depth === currentDepth,
        showToggle: false,
      });
    }
  };

  rows.forEach((row, index) => {
    closeUntilSiblingScope(row.depth);

    const nextRow = rows[index + 1];
    const hasVisibleChildren = isContainer(row) && row.expanded && nextRow?.depth === row.depth + 1;
    const comma = nextRow?.depth === row.depth;

    if (hasVisibleChildren) {
      displayRows.push({
        id: row.id,
        source: row,
        kind: "open",
        depth: row.depth,
        keyLabel: getDisplayKeyLabel(row),
        valueText: getContainerOpen(row),
        comma: false,
        showToggle: row.wasStringified,
      });
      openStack.push(row);
      return;
    }

    if (isContainer(row) && row.wasStringified && !row.expanded) {
      displayRows.push({
        id: row.id,
        source: row,
        kind: "collapsed",
        depth: row.depth,
        keyLabel: getDisplayKeyLabel(row),
        valueText: getCollapsedValue(row),
        comma,
        showToggle: true,
      });
      return;
    }

    if (isContainer(row)) {
      displayRows.push({
        id: row.id,
        source: row,
        kind: "empty",
        depth: row.depth,
        keyLabel: getDisplayKeyLabel(row),
        valueText: getEmptyContainer(row),
        comma,
        showToggle: row.wasStringified,
      });
      return;
    }

    displayRows.push({
      id: row.id,
      source: row,
      kind: "value",
      depth: row.depth,
      keyLabel: getDisplayKeyLabel(row),
      valueText: row.valueLabel,
      comma,
      showToggle: false,
    });
  });

  while (openStack.length > 0) {
    const source = openStack.pop()!;
    displayRows.push({
      id: `${source.id}:close`,
      source,
      kind: "close",
      depth: source.depth,
      keyLabel: null,
      valueText: getContainerClose(source),
      comma: false,
      showToggle: false,
    });
  }

  return displayRows;
};

export const getDisplayValueClassName = (row: DisplayTreeRow) => {
  if (row.kind === "open" || row.kind === "close" || row.kind === "empty") {
    return "text-text-secondary";
  }

  if (row.kind === "collapsed") {
    return "text-code-string";
  }

  return getValueClassName(row.source);
};

export const getValueClassName = (row: TreeRow) => {
  switch (row.kind) {
    case "string":
      return "text-code-string";
    case "number":
      return "text-code-number";
    case "boolean":
      return "text-code-boolean";
    case "null":
      return "text-code-null";
    case "object":
    case "array":
      return "text-text-tertiary";
    default:
      return "text-text-secondary";
  }
};
