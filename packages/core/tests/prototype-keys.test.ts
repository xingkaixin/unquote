import { describe, expect, it } from "vitest";
import { isPreviewRecord, materializeNode, parseInput, parsePreviewJsonlRecordLine } from "../src";

const prototypeNamedKeys = ["__proto__", "constructor", "prototype", "toString"] as const;

// Written as raw JSON: an object literal would treat `__proto__` as the
// prototype setter instead of a property.
const line = [
  '{"__proto__":"kept","constructor":"own","prototype":"own","toString":"own","safe":1,',
  '"nested":{"__proto__":"deep"},"items":[{"__proto__":"in-array"}],',
  '"stringified":"{\\"__proto__\\":\\"escaped\\"}"}',
].join("");

describe("JSON keys that shadow prototype members", () => {
  it("keeps them as own properties of a full record", () => {
    const record = parseInput(line, { forcedFormat: "jsonl" }).records[0]!;
    const node = record.node;

    expect(node?.kind === "object" && node.children).toBeDefined();
    const children = node?.kind === "object" ? (node.children ?? {}) : {};
    for (const key of prototypeNamedKeys) {
      expect(Object.hasOwn(children, key)).toBe(true);
    }
  });

  it("keeps them as own properties of a preview record", () => {
    const record = parsePreviewJsonlRecordLine(line, 1);

    expect(isPreviewRecord(record)).toBe(true);
    const fields = isPreviewRecord(record) ? (record.preview?.fields ?? {}) : {};
    for (const key of prototypeNamedKeys) {
      expect(Object.hasOwn(fields, key)).toBe(true);
      expect(fields[key]).toBe(key === "__proto__" ? "kept" : "own");
    }
  });

  it("keeps them across the structured clone that hands records to the main thread", () => {
    const record = structuredClone(parsePreviewJsonlRecordLine(line, 1));

    const fields = isPreviewRecord(record) ? (record.preview?.fields ?? {}) : {};
    for (const key of prototypeNamedKeys) {
      expect(Object.hasOwn(fields, key)).toBe(true);
    }
  });

  it("keeps them through nested containers, arrays, and stringified JSON", () => {
    const record = parseInput(line, { forcedFormat: "jsonl" }).records[0]!;
    // SAFETY: The fixture above declares all three containers; the assertions verify their own prototype keys.
    const value = materializeNode(record.node!) as {
      nested: object;
      items: object[];
      stringified: object;
    };

    expect(Object.hasOwn(value, "__proto__")).toBe(true);
    expect(Object.hasOwn(value.nested, "__proto__")).toBe(true);
    expect(Object.hasOwn(value.items[0]!, "__proto__")).toBe(true);
    expect(Object.hasOwn(value.stringified, "__proto__")).toBe(true);
  });
});
