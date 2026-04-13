import { describe, expect, it } from "vitest";
import { detectFormat, extractSummary, formatResult, parseInput, restoreNode } from "../src";

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

describe("extractSummary", () => {
  it("picks priority fields first", () => {
    expect(extractSummary({ event: "login", message: "ok" })).toContain("event:login");
  });
});
