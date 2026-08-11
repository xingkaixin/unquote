import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatResult,
  hasJsonNodeChildren,
  isStringifiedNode,
  isTruncatedJsonNode,
  materializeNode,
  parseInput,
  parseInputForIngestion,
  parseJsonlRecordLine,
  parseJsonlRecordLineWithValue,
  parsePreviewJsonlRecordLine,
  parsePreviewJsonlRecordLineWithValue,
  probeJsonl,
  restoreNode,
} from "../src";

afterEach(() => vi.restoreAllMocks());

describe("parseInput", () => {
  it("parses json and expands stringified nodes", () => {
    const result = parseInput('{"payload":"{\\"user\\":{\\"id\\":42}}"}');
    expect(result.format).toBe("json");
    const children = result.records[0]?.node?.children;
    expect(
      children && !Array.isArray(children) && children.payload
        ? isStringifiedNode(children.payload)
        : false,
    ).toBe(true);
  });

  it("stores only the facts required by each node shape", () => {
    const record = parseInput('{"object":{"value":1},"array":[true],"primitive":"text"}')
      .records[0];
    if (
      record?.status !== "full" ||
      !hasJsonNodeChildren(record.node) ||
      record.node.kind !== "object"
    ) {
      throw new Error("Expected a full object record");
    }

    expect(record.node).not.toHaveProperty("value");
    expect(record.node).not.toHaveProperty("path");
    expect(record.node).not.toHaveProperty("meta");
    expect(record.node.children.object).toMatchObject({ kind: "object" });
    expect(record.node.children.object).not.toHaveProperty("value");
    expect(record.node.children.array).toMatchObject({ kind: "array" });
    expect(record.node.children.primitive).toEqual({ kind: "string", value: "text" });
  });

  it("parses jsonl line by line", () => {
    const result = parseInput('{"event":"one"}\n{"event":"two"}', { forcedFormat: "jsonl" });
    expect(result.stats.total).toBe(2);
    expect(result.stats.success).toBe(2);
    expect(result.records[1]?.summary).toContain("event:two");
  });

  it("tracks jsonl failures", () => {
    const result = parseInput('{"ok":1}\n{bad}', { forcedFormat: "jsonl" });
    expect(result.stats.failed).toBe(1);
    expect(result.records[1]?.error).toBeTruthy();
  });

  it("does not split surrogate pairs in failed-record summaries", () => {
    const prefix = "a".repeat(71);
    const result = parseInput(`${prefix}😀{`, { forcedFormat: "jsonl" });

    expect(result.records[0]?.summary).toBe(prefix);
  });

  it("keeps forced json as a single error record for jsonl-shaped input", () => {
    const result = parseInput('{"a":1}\n{"a":2}', { forcedFormat: "json" });
    expect(result.format).toBe("json");
    expect(result.stats).toEqual({ total: 1, success: 0, failed: 1 });
    expect(result.records[0]?.error).toBeTruthy();
  });

  it("returns json parse error metadata", () => {
    const result = parseInput("{\n bad\n}");
    const record = result.records[0];

    expect(result.format).toBe("json");
    expect(record?.errorMeta).toMatchObject({
      line: 2,
      column: 2,
      rawLine: " bad",
    });
    expect(record?.rawLine).toBe(" bad");
    expect(record?.errorMeta?.context).toContain("2 |  bad");
    expect(record?.errorMeta?.context).toContain("^");
  });

  it("does not split surrogate pairs in parse-error context lines", () => {
    const prefix = "a".repeat(155);
    const previousLine = `"${prefix}😀tail",`;
    const result = parseInput(`[\n${previousLine}\n bad\n]`);

    expect(JSON.stringify(result.records[0]?.errorMeta?.context)).not.toContain("\\ud83d");
  });

  it("returns jsonl failure metadata and keeps valid records in auto mode", () => {
    const result = parseInput('{"ok":1}\n{bad}\n{"ok":2}');
    const failed = result.records[1];

    expect(result.format).toBe("jsonl");
    expect(result.stats).toEqual({ total: 3, success: 2, failed: 1 });
    expect(failed?.errorMeta).toMatchObject({
      line: 2,
      column: 2,
      rawLine: "{bad}",
    });
    expect(failed?.rawLine).toBe("{bad}");
    expect(failed?.errorMeta?.context).toContain("2 | {bad}");
  });

  it("locates the unexpected token when the engine omits a position and the token is unique", () => {
    // V8's "Unexpected token 'x'" message (no "position"/"line N column N") is the fallback
    // path getUnexpectedTokenPosition covers; 'u' occurs only once here, in "undefined".
    const input = '{"a": undefined}';
    const result = parseInput(input);
    const record = result.records[0];

    expect(record?.error).toContain("Unexpected token 'u'");
    expect(record?.errorMeta).toMatchObject({ line: 1, column: 7 });
    expect(record?.errorMeta?.context).toContain("  |       ^");
  });

  it("gives up on caret positioning when the unexpected token is ambiguous", () => {
    // 'u' also appears earlier inside the string value "contains letter u", so the first
    // occurrence found by a naive indexOf would point at the wrong place; the fallback
    // should refuse to guess instead of anchoring on that earlier, unrelated 'u'.
    const input = '{"a": "contains letter u", "b": undefined}';
    const result = parseInput(input);
    const record = result.records[0];
    const misleadingIndex = input.indexOf("u");

    expect(record?.error).toContain("Unexpected token 'u'");
    expect(record?.errorMeta?.column).not.toBe(misleadingIndex + 1);
    expect(record?.errorMeta).toMatchObject({ line: 1, column: input.length + 1 });
  });

  it("parses each physical line once when auto mode falls back to loose jsonl", () => {
    const lines = Array.from({ length: 5 }, (_, index) => `{"index":${index}}`);
    const invalidLine = "{bad}";
    const physicalLines = [...lines, invalidLine];
    const input = physicalLines.join("\n");
    const expected = parseInput(input, { forcedFormat: "jsonl" });
    const parseSpy = vi.spyOn(JSON, "parse");

    const result = parseInput(input);

    expect(result).toEqual(expected);
    for (const [index, line] of physicalLines.entries()) {
      const calls = parseSpy.mock.calls.filter(
        ([input]) =>
          input === line ||
          (line !== invalidLine &&
            typeof input === "string" &&
            !input.includes("\n") &&
            input.startsWith('{"index":') &&
            input.includes(`unquote:number${index}`)),
      );
      expect(calls).toHaveLength(1);
    }
  });

  it("retains parsed values and physical line numbers for JSONL ingestion", () => {
    const input = '{"event":"one"}\n\n{bad}\n{"count":2}';
    const parsed = parseInputForIngestion(input, { forcedFormat: "jsonl" });

    expect(parsed.format).toBe("jsonl");
    if (parsed.format !== "jsonl") {
      throw new Error("Expected JSONL ingestion lines");
    }

    expect(parsed.lines).toMatchObject([
      { record: { status: "full", lineNumber: 1 }, value: { event: "one" } },
      { record: { status: "failed", lineNumber: 3 } },
      { record: { status: "full", lineNumber: 4 }, value: { count: 2 } },
    ]);
    expect(parsed.lines[1]).not.toHaveProperty("value");
    expect(parsed.lines.map(({ record }) => record)).toEqual(
      parseInput(input, { forcedFormat: "jsonl" }).records,
    );
  });

  it("keeps single-document JSON outside the line-ingestion seam", () => {
    const input = '{"ok":true}';

    expect(parseInputForIngestion(input)).toEqual({
      format: "json",
      result: parseInput(input),
    });
  });

  it("parses a jsonl line with record identity", () => {
    const record = parseJsonlRecordLine('{"event":"two"}', 7);
    expect(record.id).toBe("record-7");
    expect(record.lineNumber).toBe(7);
    expect(record.summary).toBe("event:two");
  });

  it("does not split surrogate pairs in record summaries", () => {
    const preferredPrefix = "a".repeat(47);
    const fallbackPrefix = "b".repeat(71);

    expect(
      parseJsonlRecordLine(JSON.stringify({ message: `${preferredPrefix}😀tail` }), 1).summary,
    ).toBe(`message:${preferredPrefix}`);
    expect(
      parseJsonlRecordLine(JSON.stringify({ description: `${fallbackPrefix}😀tail` }), 2).summary,
    ).toBe(`description:${fallbackPrefix}`);
    expect(parseJsonlRecordLine(JSON.stringify(`${fallbackPrefix}😀tail`), 3).summary).toBe(
      fallbackPrefix,
    );
  });

  it("returns parsed JSONL values with full and preview records", () => {
    const line = '{"event":"two","count":2}';
    const full = parseJsonlRecordLineWithValue(line, 7);
    const preview = parsePreviewJsonlRecordLineWithValue(line, 7);
    const failed = parseJsonlRecordLineWithValue("{bad}", 8);

    expect(full).toMatchObject({
      value: { event: "two", count: 2 },
      record: { status: "full", id: "record-7" },
    });
    expect(preview).toMatchObject({
      value: { event: "two", count: 2 },
      record: { status: "preview", id: "record-7" },
    });
    expect(failed).toMatchObject({
      record: { status: "failed", id: "record-8" },
    });
    expect(failed).not.toHaveProperty("value");
  });

  it("projects Preview Records from the same stringified JSON semantics", () => {
    const line = JSON.stringify({
      object: '{"ok":true}',
      array: "[1,2]",
      string: '"abc"',
      number: "123",
      true: "true",
      false: "false",
      null: "null",
      padded: ' \n {"ok":true} \t',
      invalid: "{not json",
      empty: "",
      whitespace: " \t ",
      container: {},
    });
    const preview = parsePreviewJsonlRecordLine(line, 7);
    const hydrated = parseJsonlRecordLine(line, 7);
    if (!hydrated.node?.children || Array.isArray(hydrated.node.children)) {
      throw new Error("Expected hydrated object children");
    }

    expect(preview).toMatchObject({
      status: "preview",
      preview: {
        containers: { container: "object" },
        nestedFieldKeys: ["object", "array", "string", "number", "true", "false", "null", "padded"],
      },
    });
    expect(preview.node?.children).toBeUndefined();
    for (const [key, child] of Object.entries(hydrated.node.children)) {
      expect(isStringifiedNode(child), key).toBe(preview.preview?.nestedFieldKeys?.includes(key));
    }
  });

  it("does not split a surrogate pair in Preview Record fields", () => {
    const prefix = "a".repeat(159);
    const preview = parsePreviewJsonlRecordLine(JSON.stringify({ message: `${prefix}😀tail` }), 7);
    const message = preview.preview?.fields.message;
    if (typeof message !== "string") {
      throw new Error("Expected a string preview field");
    }

    expect(JSON.stringify(message)).not.toContain("\\ud83d");
    expect(message).toBe(prefix);
  });

  it("keeps Preview Record root string semantics aligned with Full Records", () => {
    for (const value of ['{"ok":true}', "true", "{not json"]) {
      const line = JSON.stringify(value);
      const preview = parsePreviewJsonlRecordLine(line, 3);
      const hydrated = parseJsonlRecordLine(line, 3);

      expect(isStringifiedNode(preview.node!)).toBe(isStringifiedNode(hydrated.node!));
    }
  });

  it("restores raw stringified value", () => {
    const result = parseInput('{"payload":"{\\"ok\\":true}"}');
    const root = result.records[0]?.node;
    expect(root).toBeTruthy();
    if (!root || !root.children || Array.isArray(root.children)) {
      return;
    }

    const restored = restoreNode(root, [["$", "payload"]]);
    if (!restored.children || Array.isArray(restored.children)) {
      return;
    }

    const payload = restored.children.payload;
    expect(payload).toBeTruthy();
    if (!payload) {
      return;
    }
    expect(payload.kind).toBe("string");
    expect(payload.value).toBe('{"ok":true}');
  });

  it("restores only the selected dotted key", () => {
    const result = parseInput('{"a.b":"{\\"flat\\":true}","a":{"b":"{\\"nested\\":true}"}}');
    const root = result.records[0]?.node;
    expect(root?.children).toBeTruthy();
    if (!root?.children || Array.isArray(root.children)) {
      throw new Error("Expected an object root");
    }

    const restored = restoreNode(root, [["$", "a.b"]]);
    if (!restored.children || Array.isArray(restored.children)) {
      throw new Error("Expected a restored object root");
    }

    const restoredNested = restored.children.a;
    if (!restoredNested?.children || Array.isArray(restoredNested.children)) {
      throw new Error("Expected nested object children");
    }

    expect(restored.children["a.b"]).toMatchObject({ kind: "string", value: '{"flat":true}' });
    expect(restoredNested.children.b?.kind).toBe("object");
    expect(isStringifiedNode(restoredNested.children.b!)).toBe(true);
  });

  it("matches special restore path segments exactly", () => {
    const escapedKey = 'quote"\\';
    const result = parseInput(
      JSON.stringify({
        "": JSON.stringify({ empty: true }),
        0: JSON.stringify({ numeric: true }),
        "items[0]": JSON.stringify({ flat: true }),
        [escapedKey]: JSON.stringify({ escaped: true }),
        items: [JSON.stringify({ indexed: true }), JSON.stringify({ sibling: true })],
      }),
    );
    const root = result.records[0]?.node;
    if (!root?.children || Array.isArray(root.children)) {
      throw new Error("Expected an object root");
    }

    const restored = restoreNode(root, [
      ["$", ""],
      ["$", "0"],
      ["$", "items[0]"],
      ["$", escapedKey],
    ]);
    if (!restored.children || Array.isArray(restored.children)) {
      throw new Error("Expected a restored object root");
    }

    expect(restored.children[""]).toMatchObject({ kind: "string", value: '{"empty":true}' });
    expect(restored.children["0"]).toMatchObject({ kind: "string", value: '{"numeric":true}' });
    expect(restored.children["items[0]"]).toMatchObject({ kind: "string", value: '{"flat":true}' });
    expect(restored.children[escapedKey]).toMatchObject({
      kind: "string",
      value: '{"escaped":true}',
    });

    const items = restored.children.items;
    if (!items?.children || !Array.isArray(items.children)) {
      throw new Error("Expected array children");
    }
    expect(items.children[0]?.kind).toBe("object");
    expect(isStringifiedNode(items.children[0]!)).toBe(true);

    const restoredArray = restoreNode(root, [["$", "items", "0"]]);
    if (!restoredArray.children || Array.isArray(restoredArray.children)) {
      throw new Error("Expected a restored object root");
    }
    const restoredItems = restoredArray.children.items;
    if (!restoredItems?.children || !Array.isArray(restoredItems.children)) {
      throw new Error("Expected array children");
    }
    expect(restoredItems.children[0]).toMatchObject({ kind: "string", value: '{"indexed":true}' });
    expect(restoredItems.children[1]?.kind).toBe("object");
    expect(isStringifiedNode(restoredItems.children[1]!)).toBe(true);
    expect(restoredArray.children["items[0]"]?.kind).toBe("object");
    expect(isStringifiedNode(restoredArray.children["items[0]"]!)).toBe(true);
  });

  it("formats back to json", () => {
    const result = parseInput('{"payload":"{\\"ok\\":true}"}');
    expect(formatResult(result)).toContain('"ok": true');
  });

  it("formats each JSONL record as one parseable physical line", () => {
    const result = parseInput('{"a":1}\n[1,2]\ntrue\n"text"', { forcedFormat: "jsonl" });
    const lines = formatResult(result).split("\n");

    expect(lines).toHaveLength(4);
    expect(lines.map((line) => JSON.parse(line))).toEqual([{ a: 1 }, [1, 2], true, "text"]);
  });

  it("ignores indentation for JSONL output", () => {
    const result = parseInput('{"a":{"b":1}}\n{"c":2}', { forcedFormat: "jsonl" });

    expect(formatResult(result, { indent: 8 })).toBe('{"a":{"b":1}}\n{"c":2}');
  });

  it("serializes failed JSONL records as parseable null placeholders", () => {
    const result = parseInput('{"ok":1}\n{bad}', { forcedFormat: "jsonl" });
    const lines = formatResult(result).split("\n");

    expect(lines.map((line) => JSON.parse(line))).toEqual([{ ok: 1 }, null]);
  });

  it("round-trips successful JSONL record values", () => {
    const source = '{"a":1}\n[1,2]\nfalse';
    const formatted = formatResult(parseInput(source, { forcedFormat: "jsonl" }));
    const reparsed = parseInput(formatted, { forcedFormat: "jsonl" });

    expect(reparsed.stats).toEqual({ total: 3, success: 3, failed: 0 });
    expect(reparsed.records.map((record) => materializeNode(record.node!))).toEqual([
      { a: 1 },
      [1, 2],
      false,
    ]);
  });

  it("truncates deep native containers without reporting a parse failure", () => {
    const input = `${'{"value":'.repeat(3_000)}null${"}".repeat(3_000)}`;
    const result = parseInput(input, { maxDepth: 10 });

    expect(result.stats).toEqual({ total: 1, success: 1, failed: 0 });
    let node = result.records[0]?.node;
    for (let depth = 0; depth < 10; depth += 1) {
      if (!node?.children || Array.isArray(node.children)) {
        throw new Error(`Expected object children at depth ${depth}`);
      }
      node = node.children.value;
    }
    expect(node).toMatchObject({
      kind: "object",
      truncated: true,
    });
    expect(isTruncatedJsonNode(node!)).toBe(true);
    expect(node?.children).toBeUndefined();
  });

  it("protects deep native containers with the default depth budget", () => {
    const input = `${'{"value":'.repeat(3_000)}null${"}".repeat(3_000)}`;

    expect(parseInput(input).stats).toEqual({ total: 1, success: 1, failed: 0 });
  });

  it("preserves truncated container values for materialization", () => {
    const result = parseInput('{"items":[[{"value":1}]]}', { maxDepth: 1 });
    const root = result.records[0]?.node;
    if (!root) {
      throw new Error("Expected a root node");
    }

    expect(materializeNode(root)).toEqual({ items: [[{ value: 1 }]] });
    expect(JSON.parse(formatResult(result))).toEqual({ items: [[{ value: 1 }]] });
  });

  it("applies the depth budget to stringified JSON", () => {
    const result = parseInput('{"payload":"{\\"nested\\":{\\"value\\":1}}"}', { maxDepth: 1 });
    const root = result.records[0]?.node;
    if (!root?.children || Array.isArray(root.children)) {
      throw new Error("Expected object children");
    }

    expect(root.children.payload).toMatchObject({
      kind: "object",
      truncated: true,
    });
    expect(isStringifiedNode(root.children.payload!)).toBe(true);
    expect(materializeNode(root)).toEqual({ payload: { nested: { value: 1 } } });
  });

  it("protects deep native containers in JSONL records", () => {
    const deepRecord = `${"[".repeat(3_000)}null${"]".repeat(3_000)}`;
    const result = parseInput(deepRecord, { forcedFormat: "jsonl", maxDepth: 8 });

    expect(result.stats).toEqual({ total: 1, success: 1, failed: 0 });
    expect(result.records[0]?.node?.kind).toBe("array");
  });
});

describe("probeJsonl", () => {
  it("accepts multi-line valid jsonl", () => {
    const probe = probeJsonl('{"a":1}\n{"a":2}\n{"a":3}');
    expect(probe).toEqual({ sampledLines: 3, parsableLines: 3, isLikelyJsonl: true });
  });

  it("rejects a single json document", () => {
    const probe = probeJsonl('{"a":1}');
    expect(probe.sampledLines).toBe(1);
    expect(probe.isLikelyJsonl).toBe(false);
  });

  it("rejects mixed valid and invalid lines", () => {
    const probe = probeJsonl('{"a":1}\nnot-json\n{"a":2}');
    expect(probe).toEqual({ sampledLines: 3, parsableLines: 2, isLikelyJsonl: false });
  });

  it("handles crlf line endings and skips blank lines", () => {
    const probe = probeJsonl('{"a":1}\r\n\r\n{"a":2}\r\n');
    expect(probe).toEqual({ sampledLines: 2, parsableLines: 2, isLikelyJsonl: true });
  });

  it("samples only the first lines, so later garbage is not seen", () => {
    const valid = Array.from({ length: 8 }, (_, index) => `{"line":${index}}`).join("\n");
    const probe = probeJsonl(`${valid}\nnot-json`);
    expect(probe).toEqual({ sampledLines: 8, parsableLines: 8, isLikelyJsonl: true });
  });

  it("respects a custom sample limit", () => {
    const probe = probeJsonl('{"a":1}\nnot-json\n{"a":2}', 2);
    expect(probe).toEqual({ sampledLines: 2, parsableLines: 1, isLikelyJsonl: false });
  });

  it("returns empty counts for empty input", () => {
    expect(probeJsonl("")).toEqual({ sampledLines: 0, parsableLines: 0, isLikelyJsonl: false });
  });
});
