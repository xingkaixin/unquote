import { parseInput } from "@unquote/core";
import type { JsonNode, JsonlRecord } from "@unquote/core";
import { describe, expect, it } from "vitest";
import {
  formatSelectionCopy,
  inspectorNodeLimit,
  isNodeWithinInspectorBudget,
  resolveSelectedNode,
} from "../src/lib/selected-node";

const recordOf = (source: string): JsonlRecord => parseInput(source).records[0]!;

const nodeAt = (record: JsonlRecord, pathText: string) =>
  resolveSelectedNode(record, { recordId: record.id, pathText, rawKey: "" });

const rootNodeOf = (source: string): JsonNode => {
  const record = recordOf(source);
  if (record.status !== "full") {
    throw new Error("expected a Full Record");
  }
  return record.node;
};

describe("resolveSelectedNode", () => {
  it("resolves an object key to its node and raw key", () => {
    const record = recordOf('{"a":{"b":1}}');

    expect(nodeAt(record, "$.a.b")).toMatchObject({ rawKey: "b", node: { kind: "number" } });
  });

  it("resolves an array element to its index as the raw key", () => {
    const record = recordOf('{"list":[10,20]}');

    expect(nodeAt(record, "$.list[1]")).toMatchObject({ rawKey: "1", node: { value: 20 } });
  });

  it("resolves the record root to $", () => {
    const record = recordOf('{"a":1}');

    expect(nodeAt(record, "$")).toMatchObject({ rawKey: "$", node: { kind: "object" } });
  });

  it("returns null for a path the record does not have", () => {
    const record = recordOf('{"a":1}');

    expect(nodeAt(record, "$.missing")).toBeNull();
  });
});

describe("formatSelectionCopy", () => {
  const selection = (pathText: string, rawKey: string) => ({ recordId: "r", pathText, rawKey });

  it("copies a keyed node as a key/value pair", () => {
    expect(formatSelectionCopy(selection("$.a", "a"), rootNodeOf('{"b":1}'))).toBe(
      '"a": {\n  "b": 1\n}',
    );
  });

  it("copies the root and array elements as bare values", () => {
    expect(formatSelectionCopy(selection("$", "$"), rootNodeOf("[1]"))).toBe("[\n  1\n]");
    expect(formatSelectionCopy(selection("$.list[1]", "1"), rootNodeOf("20"))).toBe("20");
  });

  it("copies an unsafe number without rounding it", () => {
    expect(formatSelectionCopy(selection("$.large", "large"), rootNodeOf("9007199254740993"))).toBe(
      '"large": 9007199254740993',
    );
  });
});

describe("isNodeWithinInspectorBudget", () => {
  it("accepts a node the inspector can materialize", () => {
    expect(isNodeWithinInspectorBudget(rootNodeOf('{"a":{"b":[1,2,3]}}'))).toBe(true);
  });

  it("rejects a node above the budget", () => {
    const list = Array.from({ length: inspectorNodeLimit + 1 }, (_, index) => index);

    expect(isNodeWithinInspectorBudget(rootNodeOf(JSON.stringify(list)))).toBe(false);
  });

  it("stops walking as soon as the budget is passed", () => {
    const leaf = rootNodeOf("[1]");
    const oversized = Array.from({ length: inspectorNodeLimit * 20 }, () => leaf);
    let reads = 0;
    // A Proxy is the only way to observe how far the walk actually got: without
    // the early stop this would read every one of the 40 000 children.
    const children = new Proxy(oversized, {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/.test(property)) {
          reads += 1;
        }
        return Reflect.get(target, property, receiver);
      },
    });

    expect(isNodeWithinInspectorBudget({ kind: "array", children })).toBe(false);
    expect(reads).toBeLessThanOrEqual(inspectorNodeLimit + 1);
  });
});
