import { parseInput } from "@unquote/core";
import type { JsonNode } from "@unquote/core";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  formatJsonValueLabel,
  getSearchableJsonValueLabelLength,
  walkJsonNode,
} from "../src/lib/json-walk";
import type { JsonWalkContext } from "../src/lib/json-walk";
import type { TreePathSegment } from "../src/lib/path-codec";

const nodeFrom = (text: string): JsonNode =>
  parseInput(text, { forcedFormat: "json" }).records[0]!.node!;

describe("walkJsonNode", () => {
  it("narrows values from their kind", () => {
    const assertNodeContext = (context: JsonWalkContext) => {
      switch (context.kind) {
        case "object":
        case "array":
        case "null":
          expectTypeOf(context.value).toEqualTypeOf<null>();
          break;
        case "string":
          expectTypeOf(context.value).toEqualTypeOf<string>();
          break;
        case "number":
          expectTypeOf(context.value).toEqualTypeOf<number | string>();
          break;
        case "boolean":
          expectTypeOf(context.value).toEqualTypeOf<boolean>();
          break;
      }
    };
    walkJsonNode(nodeFrom('[null,true,1,"value",[]]'), assertNodeContext);
  });

  it("visits every node depth-first with JSON paths", () => {
    const node = nodeFrom('{"a":1,"b":[10,20]}');
    const paths: string[] = [];
    walkJsonNode(node, (ctx) => {
      paths.push(ctx.jsonPath);
    });
    expect(paths).toEqual(["$", "$.a", "$.b", "$.b[0]", "$.b[1]"]);
  });

  it("accumulates the stringified chain across nested stringified JSON", () => {
    const node = nodeFrom('{"outer":"{\\"inner\\":1}"}');
    const chains = new Map<string, string[]>();
    walkJsonNode(node, (ctx) => {
      chains.set(ctx.jsonPath, ctx.stringifiedChain);
    });
    // `outer` was a JSON string that got expanded → it is itself stringified.
    expect(chains.get("$.outer")).toEqual(["$.outer"]);
    // its child inherits the ancestor chain.
    expect(chains.get("$.outer.inner")).toEqual(["$.outer"]);
    expect(chains.get("$")).toEqual([]);
  });

  it("stops descending when the visitor returns false", () => {
    const node = nodeFrom('{"a":{"b":1},"c":2}');
    const visited: string[] = [];
    const visit = (ctx: JsonWalkContext) => {
      visited.push(ctx.jsonPath);
      return ctx.jsonPath !== "$.a";
    };
    walkJsonNode(node, visit);
    // $.a returns false → $.a.b is skipped, but siblings still visited.
    expect(visited).toEqual(["$", "$.a", "$.c"]);
  });

  it("honors a non-root start path", () => {
    const node = nodeFrom("[5,6]");
    const paths: string[] = [];
    const segmentPaths: string[][] = [];
    const pathSegments = [{ kind: "key", value: "items" }] satisfies TreePathSegment[];
    walkJsonNode(
      node,
      (ctx) => {
        paths.push(ctx.jsonPath);
        segmentPaths.push(ctx.pathSegments.map((segment) => segment.value));
      },
      { jsonPath: "$.items", pathSegments },
    );
    expect(paths).toEqual(["$.items", "$.items[0]", "$.items[1]"]);
    expect(segmentPaths).toEqual([["items"], ["items", "0"], ["items", "1"]]);
    expect(pathSegments).toEqual([{ kind: "key", value: "items" }]);
  });

  it("exposes path segments whose last kind distinguishes object vs array members", () => {
    const node = nodeFrom('{"a":[1]}');
    const lastKindByPath = new Map<string, string>();
    walkJsonNode(node, (ctx) => {
      lastKindByPath.set(ctx.jsonPath, ctx.pathSegments.at(-1)?.kind ?? "root");
    });
    expect(lastKindByPath.get("$")).toBe("root");
    expect(lastKindByPath.get("$.a")).toBe("key");
    expect(lastKindByPath.get("$.a[0]")).toBe("index");
  });

  it("keeps truncated labels and searchable lengths on a code point boundary", () => {
    const prefix = "a".repeat(511);
    const value = `${prefix}😀tail`;
    const input = { kind: "string" as const, value, childCount: 0 };
    const label = formatJsonValueLabel(input, 512);

    expect(label).not.toContain("\\ud83d");
    expect(label).toContain(`${prefix}...`);
    expect(getSearchableJsonValueLabelLength(input, 512)).toBe(JSON.stringify(prefix).length - 1);
  });
});
