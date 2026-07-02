import { describe, expect, it } from "vitest";
import {
  detectFormat,
  extractSummary,
  formatResult,
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

  it("formats back to json", () => {
    const result = parseInput('{"payload":"{\\"ok\\":true}"}');
    expect(formatResult(result)).toContain('"ok": true');
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
