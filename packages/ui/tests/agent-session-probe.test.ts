import { describe, expect, it } from "vitest";
import { mightContainAgentSession } from "../src/lib/agent-session/probe";

describe("Agent session probe", () => {
  it("recognizes Codex and Claude transcript markers", () => {
    expect(mightContainAgentSession('{"type":"session_meta","payload":{"session_id":"s1"}}')).toBe(
      true,
    );
    expect(
      mightContainAgentSession('{"type":"assistant","uuid":"u1","message":{"role":"assistant"}}'),
    ).toBe(true);
  });

  it("rejects ordinary JSONL and markers beyond the detection window", () => {
    expect(mightContainAgentSession('{"type":"event","message":"ordinary"}')).toBe(false);

    const ordinaryLines = Array.from({ length: 80 }, (_, index) => `{"index":${index}}`);
    ordinaryLines.push('{"type":"session_meta","payload":{}}');
    expect(mightContainAgentSession(ordinaryLines.join("\n"))).toBe(false);
  });
});
