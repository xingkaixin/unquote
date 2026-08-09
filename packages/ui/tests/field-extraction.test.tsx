import { parseInput, parseJsonlRecordLine, parsePreviewJsonlRecordLine } from "@unquote/core";
import type { JsonlRecord } from "@unquote/core";
import { describe, expect, it } from "vitest";
import type { ContainerCandidate, FieldCandidate } from "../src/lib/field-extraction";
import { walkRecordFields } from "../src/lib/field-extraction";

const walk = (record: JsonlRecord) => {
  const fields: FieldCandidate[] = [];
  const containers: ContainerCandidate[] = [];
  const metrics = walkRecordFields(record, {
    onField: (candidate) =>
      fields.push({ ...candidate, pathSegments: [...candidate.pathSegments] }),
    onContainer: (candidate) =>
      containers.push({ ...candidate, pathSegments: [...candidate.pathSegments] }),
  });
  return { fields, containers, metrics };
};

describe("field-extraction", () => {
  it("emits a field candidate with primitiveValue for every keyed scalar node", () => {
    const record = parseInput('{"level":"info","count":3,"tags":["a"]}').records[0]!;

    const { fields } = walk(record);

    expect(fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "level", pathText: "$.level", primitiveValue: "info" }),
        expect.objectContaining({ key: "count", pathText: "$.count", primitiveValue: "3" }),
      ]),
    );
    // Array items without a key segment are not classifiable and stay out of
    // the candidate stream entirely.
    expect(fields.some((field) => field.pathText === "$.tags[0]")).toBe(false);
  });

  it("emits a field candidate with a null primitiveValue plus a container candidate for keyed objects/arrays", () => {
    const record = parseInput('{"error":{"message":"boom"},"items":[1,2]}').records[0]!;

    const { fields, containers } = walk(record);

    expect(fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "error", pathText: "$.error", primitiveValue: null }),
        expect.objectContaining({ key: "items", pathText: "$.items", primitiveValue: null }),
      ]),
    );
    expect(containers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "error", pathText: "$.error", kind: "object" }),
        expect.objectContaining({ key: "items", pathText: "$.items", kind: "array" }),
      ]),
    );
    expect(fields.find((field) => field.pathText === "$.error.message")?.pathSegments).toEqual([
      { kind: "key", value: "error" },
      { kind: "key", value: "message" },
    ]);
  });

  it("resolves a node container's direct child value by key, else null", () => {
    const record = parseInput(
      '{"error":{"message":"boom"},"failure":{"code":42},"broken":{"other":1},"stack":[1,2]}',
    ).records[0]!;

    const { containers } = walk(record);
    const byKey = (key: string) => containers.find((candidate) => candidate.key === key)!;
    const fallbackKeys = ["message", "msg", "name", "type", "code"];

    expect(byKey("error").getChildValue(fallbackKeys)).toBe("boom");
    expect(byKey("failure").getChildValue(fallbackKeys)).toBe("42");
    expect(byKey("broken").getChildValue(fallbackKeys)).toBeNull();
    expect(byKey("stack").getChildValue(fallbackKeys)).toBeNull();
  });

  it("counts every stringified node in nestedCount", () => {
    const record = parseInput('{"payload":"{\\"nested\\":true}","other":"{\\"n\\":1}"}')
      .records[0]!;

    expect(walk(record).metrics.nestedCount).toBe(2);
  });

  it("computes maxDepth across the full tree, unaffected by candidate dispatch", () => {
    const record = parseInput('{"error":{"nested":{"deep":{"value":1}}}}').records[0]!;

    const { metrics } = walk(record);

    expect(metrics.maxDepth).toBe(4);
  });

  it("derives candidates from a Preview Record instead of the node tree", () => {
    const record = {
      id: "record-1",
      lineNumber: 1,
      status: "preview",
      node: {
        kind: "object",
        childCount: 0,
        preview: true,
      },
      preview: {
        fields: { event: "tool_call", tool: "billing.search" },
        containers: { error: "object" },
        nestedFieldKeys: ["payload"],
      },
      summary: "event:tool_call",
    } satisfies JsonlRecord;

    const { fields, containers, metrics } = walk(record);

    expect(fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "event", pathText: "$.event", primitiveValue: "tool_call" }),
        expect.objectContaining({
          key: "tool",
          pathText: "$.tool",
          primitiveValue: "billing.search",
        }),
      ]),
    );
    expect(containers).toEqual([
      expect.objectContaining({ key: "error", pathText: "$.error", kind: "object" }),
    ]);
    // Preview containers carry no child data to inspect.
    expect(containers[0]!.getChildValue(["message"])).toBeNull();
    expect(metrics).toEqual({ maxDepth: 1, nestedCount: 1 });
  });

  it.each([
    "9007199254740991",
    "9007199254740993",
    "-9007199254740993",
    "0.12345678901234567890123456789",
    "1e3",
    "1e309",
    "1e400",
  ])("keeps Preview and Full field facts equal for %s", (rawValue) => {
    const source = `{"value":${rawValue},"stringValue":"${rawValue}","flag":true,"empty":null}`;
    const preview = parsePreviewJsonlRecordLine(source, 1);
    const full = parseJsonlRecordLine(source, 1);

    expect(walk(preview).fields).toEqual(walk(full).fields);
  });

  it("does nothing for a record with neither a node nor a preview", () => {
    const failed = parseInput("not-json", { forcedFormat: "jsonl" }).records[0]!;
    const { fields, containers, metrics } = walk(failed);

    expect(fields).toEqual([]);
    expect(containers).toEqual([]);
    expect(metrics).toEqual({ maxDepth: 0, nestedCount: 0 });
  });
});
