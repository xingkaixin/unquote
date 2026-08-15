import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useOutputView } from "../src/hooks/use-output-view";
import type { AgentSession } from "../src/lib/agent-session";
import type { SourceRevision } from "../src/lib/source-revision";

interface OutputViewProps {
  sourceRevision: SourceRevision;
  agentSession: AgentSession | null;
}

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

const renderOutputView = (initialProps: OutputViewProps) =>
  renderHook(
    ({ sourceRevision, agentSession }: OutputViewProps) =>
      useOutputView(sourceRevision, agentSession),
    { initialProps },
  );

describe("useOutputView", () => {
  it("defaults Agent once and preserves a manual JSON choice through updates to one revision", () => {
    const firstRevision = 1;
    const { result, rerender } = renderOutputView({
      sourceRevision: firstRevision,
      agentSession: null,
    });

    expect(result.current.outputView).toBe("json");

    rerender({ sourceRevision: firstRevision, agentSession: createSession(0) });
    expect(result.current.outputView).toBe("agent");

    act(() => result.current.setOutputView("json"));
    rerender({ sourceRevision: firstRevision, agentSession: createSession(0) });
    expect(result.current.outputView).toBe("json");

    rerender({ sourceRevision: firstRevision, agentSession: createSession(1) });
    expect(result.current.outputView).toBe("json");
  });

  it("defaults Agent for a new revision with the same session structure", () => {
    const { result, rerender } = renderOutputView({
      sourceRevision: 1,
      agentSession: createSession(0),
    });

    expect(result.current.outputView).toBe("agent");

    act(() => result.current.setOutputView("json"));
    rerender({ sourceRevision: 2, agentSession: createSession(0) });

    expect(result.current.outputView).toBe("agent");
  });

  it("defaults an asynchronously recognized Agent session only once per revision", () => {
    const thirdRevision = 3;
    const { result, rerender } = renderOutputView({
      sourceRevision: thirdRevision,
      agentSession: null,
    });

    rerender({ sourceRevision: thirdRevision, agentSession: createSession(0) });
    expect(result.current.outputView).toBe("agent");

    act(() => result.current.setOutputView("json"));
    rerender({ sourceRevision: thirdRevision, agentSession: createSession(0) });

    expect(result.current.outputView).toBe("json");
  });

  it("forces JSON for a new revision without an Agent session", () => {
    const { result, rerender } = renderOutputView({
      sourceRevision: 1,
      agentSession: createSession(0),
    });

    expect(result.current.outputView).toBe("agent");

    rerender({ sourceRevision: 4, agentSession: null });

    expect(result.current.outputView).toBe("json");
  });

  it("defaults Agent after returning through a non-Agent revision", () => {
    const { result, rerender } = renderOutputView({
      sourceRevision: 1,
      agentSession: createSession(0),
    });

    act(() => result.current.setOutputView("json"));
    rerender({ sourceRevision: 2, agentSession: null });
    expect(result.current.outputView).toBe("json");

    rerender({ sourceRevision: 1, agentSession: createSession(0) });

    expect(result.current.outputView).toBe("agent");
  });

  it("defaults Agent after returning from another Agent revision", () => {
    const { result, rerender } = renderOutputView({
      sourceRevision: 1,
      agentSession: createSession(0),
    });

    act(() => result.current.setOutputView("json"));
    rerender({ sourceRevision: 2, agentSession: createSession(0) });
    expect(result.current.outputView).toBe("agent");

    act(() => result.current.setOutputView("json"));
    rerender({ sourceRevision: 1, agentSession: createSession(0) });

    expect(result.current.outputView).toBe("agent");
  });

  it("does not default Agent again when a session disappears and returns within one revision", () => {
    const firstRevision = 1;
    const { result, rerender } = renderOutputView({
      sourceRevision: firstRevision,
      agentSession: createSession(0),
    });

    expect(result.current.outputView).toBe("agent");

    rerender({ sourceRevision: firstRevision, agentSession: null });
    expect(result.current.outputView).toBe("json");

    rerender({ sourceRevision: firstRevision, agentSession: createSession(0) });

    expect(result.current.outputView).toBe("json");
  });
});
