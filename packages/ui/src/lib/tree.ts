import type { JsonNode, JsonlRecord } from "@unquote/core";
import { isParsed, isStringifiedNode, materializeNode } from "@unquote/core";
import { getPreviewPath } from "./record-preview";
import { formatJsonValueLabel, maxStringValueLabelLength, walkJsonNode } from "./json-walk";

export interface TreeRow {
  id: string;
  pathText: string;
  depth: number;
  keyLabel: string;
  kind: JsonNode["kind"];
  valueLabel: string;
  wasStringified: boolean;
  expanded: boolean;
  node: JsonNode;
}

export const buildRecordRows = (
  record: JsonlRecord,
  expandedStringifiedPaths: ReadonlySet<string>,
) => {
  if (!isParsed(record)) {
    return [];
  }

  const rows: TreeRow[] = [];
  walkJsonNode(record.node, (ctx) => {
    const wasStringified = isStringifiedNode(ctx.node);
    const expanded = !wasStringified || expandedStringifiedPaths.has(ctx.jsonPath);
    rows.push({
      id: `${record.id}:${ctx.jsonPath}`,
      pathText: ctx.jsonPath,
      depth: ctx.pathSegments.length,
      keyLabel: ctx.pathSegments.at(-1)?.value ?? "$",
      kind: ctx.node.kind,
      valueLabel: formatJsonValueLabel(ctx, maxStringValueLabelLength),
      wasStringified,
      expanded,
      node: ctx.node,
    });
    return expanded;
  });
  return rows;
};

export const materializeRecord = (record: JsonlRecord) => {
  if (!isParsed(record)) {
    return null;
  }

  return materializeNode(record.node);
};

const collectPaths = (
  node: JsonNode,
  expandedStringifiedPaths: ReadonlySet<string>,
  output: Set<string>,
  pathText = "$",
) => {
  walkJsonNode(
    node,
    (ctx) => {
      if (isStringifiedNode(ctx.node)) {
        output.add(ctx.jsonPath);
      }
      return !isStringifiedNode(ctx.node) || expandedStringifiedPaths.has(ctx.jsonPath);
    },
    { jsonPath: pathText },
  );
};

export const collectStringifiedPaths = (
  record: JsonlRecord,
  expandedStringifiedPaths: ReadonlySet<string>,
) => {
  // A Preview Record's projected node carries no children, so walking it finds
  // nothing. Its preview already records which top-level fields hold nested
  // JSON. Deeper levels surface once the Full Record resolves and the walk below
  // takes over.
  if (record.status === "preview" && record.preview) {
    return (record.preview.nestedFieldKeys ?? []).map(getPreviewPath);
  }

  if (!isParsed(record)) {
    return [];
  }

  const output = new Set<string>();
  collectPaths(record.node, expandedStringifiedPaths, output);
  return [...output];
};
