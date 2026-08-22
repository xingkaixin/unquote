import { describe, expect, it } from "vitest";
import { isRecord } from "../src/lib/agent-session/shared";

describe("agent session raw data boundary", () => {
  it("accepts keyed objects and rejects arrays", () => {
    expect(isRecord({ type: "event_msg" })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
  });
});
