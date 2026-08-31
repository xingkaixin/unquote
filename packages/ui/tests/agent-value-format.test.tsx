import { describe, expect, it } from "vitest";
import {
  formatAgentBlockValue,
  formatAgentPreviewValue,
  truncateBlockText,
  truncatePreview,
} from "../src/lib/agent-session/agent-value-format";

describe("agent value formatting", () => {
  it("preserves the existing layouts for ordinary JSON values", () => {
    const value = { path: "/tmp", flags: [true, null] };

    expect(formatAgentBlockValue(value)).toBe(JSON.stringify(value, null, 2));
    expect(formatAgentPreviewValue(value)).toBe('{ "path": "/tmp", "flags": [ true, null ] }');
  });

  it("matches JSON primitive and escaping semantics", () => {
    const value = {
      negativeZero: -0,
      nonFinite: Number.POSITIVE_INFINITY,
      omitted: undefined,
      values: [undefined, Number.NaN, 'quote"\n😀\ud800'],
    };

    expect(formatAgentBlockValue(value)).toBe(JSON.stringify(value, null, 2));
  });

  it("bounds deeply nested values without recursing on the JavaScript stack", () => {
    let value: unknown = "leaf";
    for (let depth = 0; depth < 7_000; depth += 1) {
      value = [value];
    }

    expect(() => formatAgentBlockValue(value)).not.toThrow();
    expect(formatAgentBlockValue(value)).toMatch(/\.\.\. \[truncated\]$/);
    expect(formatAgentBlockValue(value).length).toBeLessThanOrEqual(8_015);
  });

  it("stops reading later properties after reaching the output budget", () => {
    let laterPropertyRead = false;
    const value = {
      first: "x".repeat(20_000),
      get later() {
        laterPropertyRead = true;
        return "unexpected";
      },
    };

    expect(formatAgentBlockValue(value)).toMatch(/\.\.\. \[truncated\]$/);
    expect(laterPropertyRead).toBe(false);
  });

  it("keeps preview truncation on a code point boundary", () => {
    const prefix = "a".repeat(159);
    const preview = truncatePreview(`${prefix}😀tail`);

    expect(preview).toBe(`${prefix}... [truncated]`);
    expect(JSON.stringify(preview)).not.toContain("\\ud83d");
  });

  it("keeps block-text truncation on a code point boundary", () => {
    const prefix = "a".repeat(7_999);
    const block = truncateBlockText(`${prefix}😀tail`);

    expect(block).toBe(`${prefix}... [truncated]`);
    expect(JSON.stringify(block)).not.toContain("\\ud83d");
  });
});
