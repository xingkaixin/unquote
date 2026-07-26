import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useOutputView } from "../src/hooks/use-output-view";
import type { AgentSession } from "../src/lib/agent-session";

const createSession = (eventCount: number): AgentSession => ({
  fileType: "Codex",
  meta: {
    sessionId: "session-1",
    eventCount,
    turnCount: 0,
  },
  events: Array.from({ length: eventCount }, (_, index) => ({
    id: `event-${index}`,
    recordId: `record-${index}`,
    lineNumber: index + 1,
    category: "assistant",
    kind: "message",
    label: "Assistant",
    preview: "",
    conversationItems: [],
  })),
  parseWarnings: [],
});

describe("useOutputView", () => {
  it("defaults new Agent sessions while preserving a manual choice for the same session key", () => {
    const { result, rerender } = renderHook(({ session }) => useOutputView(session), {
      initialProps: { session: null as AgentSession | null },
    });

    expect(result.current.outputView).toBe("json");

    rerender({ session: createSession(0) });
    expect(result.current.outputView).toBe("agent");

    act(() => result.current.setOutputView("json"));
    rerender({ session: createSession(0) });
    expect(result.current.outputView).toBe("json");

    rerender({ session: createSession(1) });
    expect(result.current.outputView).toBe("agent");

    rerender({ session: null });
    expect(result.current.outputView).toBe("json");
  });
});
