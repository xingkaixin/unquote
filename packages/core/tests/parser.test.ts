import { describe, expect, it } from "vitest";
import {
  detectFormat,
  extractSummary,
  formatResult,
  materializeNode,
  parseInput,
  parseJsonlRecordLine,
  probeJsonl,
  restoreNode,
} from "../src";

describe("parseInput", () => {
  it("parses json and expands stringified nodes", () => {
    const result = parseInput('{"payload":"{\\"user\\":{\\"id\\":42}}"}');
    expect(result.format).toBe("json");
    const children = result.records[0]?.node?.children;
    expect(children && !Array.isArray(children) ? children.payload?.wasStringified : false).toBe(
      true,
    );
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

  it("parses a jsonl line with source line metadata", () => {
    const record = parseJsonlRecordLine('{"event":"two"}', 7);
    expect(record.id).toBe("record-7");
    expect(record.lineNumber).toBe(7);
    expect(record.node?.meta.sourceLine).toBe(7);
    expect(record.summary).toBe("event:two");
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
    expect(restoredNested.children.b).toMatchObject({ kind: "object", wasStringified: true });
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
    expect(items.children[0]).toMatchObject({ kind: "object", wasStringified: true });

    const restoredArray = restoreNode(root, [["$", "items", "0"]]);
    if (!restoredArray.children || Array.isArray(restoredArray.children)) {
      throw new Error("Expected a restored object root");
    }
    const restoredItems = restoredArray.children.items;
    if (!restoredItems?.children || !Array.isArray(restoredItems.children)) {
      throw new Error("Expected array children");
    }
    expect(restoredItems.children[0]).toMatchObject({ kind: "string", value: '{"indexed":true}' });
    expect(restoredItems.children[1]).toMatchObject({ kind: "object", wasStringified: true });
    expect(restoredArray.children["items[0]"]).toMatchObject({
      kind: "object",
      wasStringified: true,
    });
  });

  it("formats back to json", () => {
    const result = parseInput('{"payload":"{\\"ok\\":true}"}');
    expect(formatResult(result)).toContain('"ok": true');
  });

  it("truncates deep native containers without reporting a parse failure", () => {
    const input = `${'{"value":'.repeat(3_000)}null${"}".repeat(3_000)}`;
    const result = parseInput(input, { maxDepth: 10 });

    expect(result.stats).toEqual({ total: 1, success: 1, failed: 0 });
    let node = result.records[0]?.node;
    for (let depth = 0; depth < 10; depth += 1) {
      expect(node?.meta.depth).toBe(depth);
      if (!node?.children || Array.isArray(node.children)) {
        throw new Error(`Expected object children at depth ${depth}`);
      }
      node = node.children.value;
    }
    expect(node).toMatchObject({
      kind: "object",
      meta: { depth: 10, expandable: true, truncated: true },
    });
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
      wasStringified: true,
      meta: { depth: 1, truncated: true },
    });
    expect(materializeNode(root)).toEqual({ payload: { nested: { value: 1 } } });
  });

  it("protects deep native containers in JSONL records", () => {
    const deepRecord = `${"[".repeat(3_000)}null${"]".repeat(3_000)}`;
    const result = parseInput(deepRecord, { forcedFormat: "jsonl", maxDepth: 8 });

    expect(result.stats).toEqual({ total: 1, success: 1, failed: 0 });
    expect(result.records[0]?.node?.kind).toBe("array");
  });
});

describe("detectFormat", () => {
  it("detects jsonl when every line is valid json", () => {
    expect(detectFormat('{"a":1}\n{"a":2}')).toBe("jsonl");
  });

  it("falls back to json for regular documents", () => {
    expect(detectFormat('{"a":[1,2,3]}')).toBe("json");
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

describe("extractSummary", () => {
  it("picks priority fields first", () => {
    expect(extractSummary({ event: "login", message: "ok" })).toContain("event:login");
  });
});
