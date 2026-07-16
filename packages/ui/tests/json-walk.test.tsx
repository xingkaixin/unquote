import { parseInput } from "@unquote/core";
import type { JsonNode } from "@unquote/core";
import { describe, expect, it } from "vitest";
import { walkJsonNode, walkRawJsonValue } from "../src/lib/json-walk";
import type { JsonWalkContext } from "../src/lib/json-walk";

const nodeFrom = (text: string): JsonNode =>
  parseInput(text, { forcedFormat: "json" }).records[0]!.node!;

describe("walkJsonNode", () => {
  it("keeps node and raw adapters aligned", () => {
    const text = JSON.stringify({
      "a.b": [1, true],
      payload: JSON.stringify({ nested: [{ value: null }] }),
    });
    const nodeContexts: unknown[] = [];
    const rawContexts: unknown[] = [];
    const selectContext = (ctx: {
      jsonPath: string;
      jqPath: string;
      kind: string;
      childCount: number;
      stringifiedChain: string[];
    }) => ({
      jsonPath: ctx.jsonPath,
      jqPath: ctx.jqPath,
      kind: ctx.kind,
      childCount: ctx.childCount,
      stringifiedChain: ctx.stringifiedChain,
    });

    walkJsonNode(nodeFrom(text), (ctx) => {
      nodeContexts.push(selectContext(ctx));
    });
    walkRawJsonValue(JSON.parse(text), (ctx) => {
      rawContexts.push(selectContext(ctx));
    });

    expect(rawContexts).toEqual(nodeContexts);
  });

  it("visits every node depth-first with json and jq paths", () => {
    const node = nodeFrom('{"a":1,"b":[10,20]}');
    const seen: { json: string; jq: string }[] = [];
    walkJsonNode(node, (ctx) => {
      seen.push({ json: ctx.jsonPath, jq: ctx.jqPath });
    });
    expect(seen.map((s) => s.json)).toEqual(["$", "$.a", "$.b", "$.b[0]", "$.b[1]"]);
    expect(seen.map((s) => s.jq)).toEqual([".", ".a", ".b", ".b[0]", ".b[1]"]);
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
    walkJsonNode(
      node,
      (ctx) => {
        paths.push(ctx.jsonPath);
      },
      { jsonPath: "$.items", jqPath: ".items" },
    );
    expect(paths).toEqual(["$.items", "$.items[0]", "$.items[1]"]);
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
});
