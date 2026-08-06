import type { JsonNode } from "@unquote/core";
import { parseInput } from "@unquote/core";
import { describe, expect, it } from "vitest";
import type { TreeRow } from "../src/lib/tree";
import { buildRecordRows } from "../src/lib/tree";
import {
  buildDisplayRows,
  getCollapsedValue,
  getDisplayKeyLabel,
  getDisplayValueClassName,
  getValueClassName,
} from "../src/lib/tree-display";

const nodeSource: Record<JsonNode["kind"], string> = {
  object: "{}",
  array: "[]",
  string: '""',
  number: "0",
  boolean: "false",
  null: "null",
};

const makeNode = (kind: JsonNode["kind"], overrides: Partial<JsonNode> = {}): JsonNode =>
  ({
    ...parseInput(nodeSource[kind], { forcedFormat: "json" }).records[0]!.node!,
    ...overrides,
  }) as JsonNode;

const makeRow = (
  overrides: Partial<TreeRow> & Pick<TreeRow, "id" | "pathText" | "depth" | "kind">,
): TreeRow => ({
  keyLabel: "$",
  valueLabel: "",
  wasStringified: false,
  insideStringified: false,
  expanded: false,
  node: makeNode(overrides.kind),
  ...overrides,
});

describe("buildDisplayRows", () => {
  it("passes ordinary sibling rows through with sibling commas", () => {
    const record = parseInput('{"a":1,"b":2}').records[0]!;
    const rows = buildRecordRows(record, new Set());
    const displayRows = buildDisplayRows(rows);

    expect(displayRows.map((row) => [row.kind, row.valueText, row.comma])).toEqual([
      ["open", "{", false],
      ["value", "1", true],
      ["value", "2", false],
      ["close", "}", false],
    ]);
  });

  it("pairs an expanded stringified container with open, nested, and close rows", () => {
    const record = parseInput('{"payload":"{\\"a\\":1}"}').records[0]!;
    const rows = buildRecordRows(record, new Set(["$.payload"]));
    const displayRows = buildDisplayRows(rows);

    expect(displayRows.map((row) => row.kind)).toEqual(["open", "open", "value", "close", "close"]);

    const payloadOpen = displayRows[1]!;
    const payloadClose = displayRows[3]!;
    expect(payloadOpen.showToggle).toBe(true);
    expect(payloadOpen.valueText).toBe("{");
    expect(payloadClose.valueText).toBe("}");
    // A close row's id/source must point back to the exact open row it terminates.
    expect(payloadClose.source).toBe(payloadOpen.source);
    expect(payloadClose.id).toBe(`${payloadOpen.source.id}:close`);
  });

  it("renders a collapsed stringified container without descending into its children", () => {
    const record = parseInput('{"payload":"{\\"a\\":1}"}').records[0]!;
    const rows = buildRecordRows(record, new Set());
    const displayRows = buildDisplayRows(rows);

    expect(displayRows.map((row) => [row.kind, row.showToggle])).toEqual([
      ["open", false],
      ["collapsed", true],
      ["close", false],
    ]);

    const payloadRow = displayRows[1]!;
    expect(payloadRow.valueText).toBe(getCollapsedValue(payloadRow.source));
    expect(payloadRow.comma).toBe(false);
  });

  it("renders an empty container inline instead of opening a nested scope", () => {
    const record = parseInput('{"a":{}}').records[0]!;
    const rows = buildRecordRows(record, new Set());
    const displayRows = buildDisplayRows(rows);

    expect(displayRows.map((row) => [row.kind, row.valueText])).toEqual([
      ["open", "{"],
      ["empty", "{}"],
      ["close", "}"],
    ]);

    const emptyRow = displayRows[1]!;
    expect(emptyRow.showToggle).toBe(false);
    expect(emptyRow.comma).toBe(false);
  });

  it("closes every open scope down to the shared ancestor when returning to a shallower sibling", () => {
    const root = makeRow({
      id: "r0",
      pathText: "$",
      depth: 0,
      kind: "object",
      expanded: true,
    });
    const list = makeRow({
      id: "r1",
      pathText: "$.list",
      depth: 1,
      kind: "array",
      expanded: true,
    });
    const item = makeRow({
      id: "r2",
      pathText: "$.list[0]",
      depth: 2,
      kind: "object",
      expanded: true,
    });
    const leaf = makeRow({
      id: "r3",
      pathText: "$.list[0].x",
      depth: 3,
      kind: "number",
      valueLabel: "1",
    });
    const sibling = makeRow({
      id: "r4",
      pathText: "$.b",
      depth: 1,
      kind: "number",
      valueLabel: "2",
    });

    const displayRows = buildDisplayRows([root, list, item, leaf, sibling]);

    expect(displayRows.map((row) => row.kind)).toEqual([
      "open",
      "open",
      "open",
      "value",
      "close",
      "close",
      "value",
      "close",
    ]);

    // Depth regression from 3 (leaf) to 1 (sibling) must close both the
    // object ($.list[0]) and the array ($.list) before the sibling row.
    const [itemClose, listClose] = displayRows.slice(4, 6);
    expect(itemClose!.source.id).toBe("r2");
    expect(itemClose!.id).toBe("r2:close");
    expect(itemClose!.comma).toBe(false);
    expect(listClose!.source.id).toBe("r1");
    expect(listClose!.id).toBe("r1:close");
    expect(listClose!.comma).toBe(true);

    // The root ($) only closes once no more rows remain.
    const rootClose = displayRows.at(-1)!;
    expect(rootClose.source.id).toBe("r0");
    expect(rootClose.comma).toBe(false);
  });
});

describe("getDisplayKeyLabel", () => {
  it("hides the key label for the root row", () => {
    const row = makeRow({ id: "r0", pathText: "$", depth: 0, kind: "object", keyLabel: "$" });
    expect(getDisplayKeyLabel(row)).toBeNull();
  });

  it("hides the key label for array element rows", () => {
    const row = makeRow({
      id: "r1",
      pathText: "$.list[0]",
      depth: 1,
      kind: "number",
      keyLabel: "0",
    });
    expect(getDisplayKeyLabel(row)).toBeNull();
  });

  it("keeps a quoted object key label, including numeric-looking keys", () => {
    const row = makeRow({
      id: "r2",
      pathText: '$.payload["0"]',
      depth: 1,
      kind: "string",
      keyLabel: "0",
    });
    expect(getDisplayKeyLabel(row)).toBe("0");
  });
});

describe("getCollapsedValue", () => {
  it("re-quotes the original raw string for a collapsed stringified container", () => {
    const row = makeRow({
      id: "r0",
      pathText: "$.payload",
      depth: 0,
      kind: "object",
      wasStringified: true,
      valueLabel: '"{ some truncated label }"',
      node: makeNode("object", { rawString: '{"a":1}' }),
    });

    expect(getCollapsedValue(row)).toBe(JSON.stringify('{"a":1}'));
  });

  it("uses the full raw string rather than the truncated value label", () => {
    const rawString = `{"a":"${"x".repeat(600)}"}`;
    const row = makeRow({
      id: "r0",
      pathText: "$.payload",
      depth: 0,
      kind: "object",
      wasStringified: true,
      valueLabel: "600 chars truncated",
      node: makeNode("object", { rawString }),
    });

    expect(getCollapsedValue(row)).toBe(JSON.stringify(rawString));
  });

  it("falls back to the value label when there is no raw string", () => {
    const row = makeRow({
      id: "r0",
      pathText: "$.payload",
      depth: 0,
      kind: "object",
      wasStringified: true,
      valueLabel: "fallback label",
      node: makeNode("object"),
    });

    expect(getCollapsedValue(row)).toBe("fallback label");
  });
});

describe("getValueClassName", () => {
  it.each([
    ["string", "text-code-string"],
    ["number", "text-code-number"],
    ["boolean", "text-code-boolean"],
    ["null", "text-code-null"],
    ["object", "text-text-tertiary"],
    ["array", "text-text-tertiary"],
  ] satisfies Array<[JsonNode["kind"], string]>)("maps %s rows to %s", (kind, className) => {
    const row = makeRow({ id: "r0", pathText: "$", depth: 0, kind });
    expect(getValueClassName(row)).toBe(className);
  });
});

describe("getDisplayValueClassName", () => {
  const baseRow = makeRow({ id: "r0", pathText: "$", depth: 0, kind: "string" });

  it.each([
    ["open", "text-text-secondary"],
    ["close", "text-text-secondary"],
    ["empty", "text-text-secondary"],
    ["collapsed", "text-code-string"],
  ] as const)("maps display kind %s to %s", (kind, className) => {
    const displayRow = {
      id: "r0",
      source: baseRow,
      kind,
      depth: 0,
      keyLabel: null,
      valueText: "",
      comma: false,
      showToggle: false,
    } as const;
    expect(getDisplayValueClassName(displayRow)).toBe(className);
  });

  it("delegates to getValueClassName for value rows", () => {
    const numberRow = makeRow({ id: "r1", pathText: "$.n", depth: 0, kind: "number" });
    const displayRow = {
      id: "r1",
      source: numberRow,
      kind: "value",
      depth: 0,
      keyLabel: null,
      valueText: "1",
      comma: false,
      showToggle: false,
    } as const;
    expect(getDisplayValueClassName(displayRow)).toBe(getValueClassName(numberRow));
  });
});
