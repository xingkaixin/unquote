import { describe, expect, it } from "vitest";
import { truncateBlockText, truncatePreview } from "../src/lib/agent-session/shared";

describe("agent session text truncation", () => {
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
