import { parseInput, parsePreviewJsonlRecordLine } from "@unquote/core";
import type { FullJsonNode, JsonlRecord } from "@unquote/core";
import { describe, expect, it, vi } from "vitest";
import { copyBytesLimit } from "../src/lib/record-export";
import {
  inspectorCharLimit,
  inspectorNodeLimit,
  projectSelectedNode,
} from "../src/lib/selected-node";

const recordOf = (source: string): JsonlRecord => parseInput(source).records[0]!;

const recordWithNode = (node: FullJsonNode): JsonlRecord => ({
  status: "full",
  id: "record-1",
  lineNumber: 1,
  summary: "test",
  node,
});

const projectAt = (record: JsonlRecord, pathText: string, rawKey: string) =>
  projectSelectedNode(record, { recordId: record.id, pathText, rawKey });

const copyText = (projection: ReturnType<typeof projectSelectedNode>) => {
  expect(projection.copy.kind).toBe("available");
  if (projection.copy.kind !== "available") {
    throw new Error("expected copy to be available");
  }
  return projection.copy.format();
};

describe("projectSelectedNode", () => {
  it("resolves object, array, and root selections", () => {
    const record = recordOf('{"a":{"list":[10,20]}}');

    expect(projectAt(record, "$.a", "a")).toMatchObject({
      kind: "value",
      selection: { rawKey: "a" },
      text: '{\n  "list": [\n    10,\n    20\n  ]\n}',
    });
    expect(projectAt(record, "$.a.list[1]", "1")).toMatchObject({ kind: "value", text: "20" });
    expect(projectAt(record, "$", "$")).toMatchObject({ kind: "value" });
  });

  it("returns explicit empty and loading states", () => {
    const record = recordOf('{"a":1}');
    const preview = parsePreviewJsonlRecordLine('{"a":1}', 1);

    expect(projectAt(record, "$.missing", "missing")).toEqual({
      kind: "empty",
      copy: { kind: "blocked" },
    });
    expect(projectAt(preview, "$.a", "a")).toMatchObject({
      kind: "loading",
      copy: { kind: "blocked" },
    });
  });

  it("preserves keyed, root, array, stringified, and lossless-number copy formats", () => {
    const keyed = recordOf('{"payload":"{\\"ok\\":true}"}');
    const array = recordOf("[10,9007199254740993]");

    expect(copyText(projectAt(keyed, "$.payload", "payload"))).toBe(
      '"payload": {\n  "ok": true\n}',
    );
    expect(copyText(projectAt(array, "$", "$"))).toBe("[\n  10,\n  9007199254740993\n]");
    expect(copyText(projectAt(array, "$[1]", "1"))).toBe("9007199254740993");
  });

  it("escapes strings exactly like JSON.stringify", () => {
    const value = 'quote " slash \\ controls \n lone \ud800 emoji 😀';
    const record = recordWithNode({ kind: "string", value });

    expect(copyText(projectAt(record, "$", "$"))).toBe(JSON.stringify(value));
  });

  it("bounds a giant primitive before copy can allocate its full serialization", () => {
    const value = "x".repeat(copyBytesLimit + 1);
    const record = recordWithNode({ kind: "string", value });
    const stringify = vi.spyOn(JSON, "stringify");

    const projection = projectAt(record, "$", "$");
    const nestedProjection = projectAt(
      recordWithNode({ kind: "object", children: { nested: { kind: "string", value } } }),
      "$",
      "$",
    );

    expect(projection).toMatchObject({
      kind: "value",
      truncated: true,
      copy: { kind: "blocked" },
    });
    expect(nestedProjection).toMatchObject({
      kind: "value",
      truncated: true,
      copy: { kind: "blocked" },
    });
    expect(projection.kind === "value" ? projection.text.length : 0).toBe(inspectorCharLimit);
    expect(nestedProjection.kind === "value" ? nestedProjection.text.length : 0).toBe(
      inspectorCharLimit,
    );
    expect(stringify.mock.calls.some(([input]) => input === value)).toBe(false);
    stringify.mockRestore();
  });

  it("stops a wide node as soon as the node budget is exceeded", () => {
    const leaf: FullJsonNode = { kind: "number", value: 1, rawValue: "1" };
    const values = Array.from({ length: inspectorNodeLimit * 20 }, () => leaf);
    let reads = 0;
    const children = new Proxy(values, {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/.test(property)) {
          reads += 1;
        }
        return Reflect.get(target, property, receiver);
      },
    });

    expect(projectAt(recordWithNode({ kind: "array", children }), "$", "$")).toMatchObject({
      kind: "too-large",
      copy: { kind: "blocked" },
    });
    expect(reads).toBeLessThanOrEqual(inspectorNodeLimit);
  });

  it("counts values hidden inside truncated containers", () => {
    const items = Array.from({ length: inspectorNodeLimit + 1 }, () => ({
      type: "number" as const,
      rawValue: "1",
    }));
    const record = recordWithNode({
      kind: "array",
      truncated: true,
      value: { type: "array", items },
    });

    expect(projectAt(record, "$", "$")).toMatchObject({
      kind: "too-large",
      copy: { kind: "blocked" },
    });
  });

  it("serializes deep values iteratively while bounding only the preview", () => {
    let node: FullJsonNode = { kind: "number", value: 1, rawValue: "1" };
    for (let depth = 0; depth < 1000; depth += 1) {
      node = { kind: "array", children: [node] };
    }

    const projection = projectAt(recordWithNode(node), "$", "$");

    expect(projection).toMatchObject({
      kind: "value",
      truncated: true,
      copy: { kind: "available" },
    });
    expect(copyText(projection).startsWith("[\n  [")).toBe(true);
  });
});
