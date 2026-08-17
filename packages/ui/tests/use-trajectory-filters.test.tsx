import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useTrajectoryFilters } from "../src/hooks/use-trajectory-filters";
import { createAgentSessionModel } from "../src/lib/agent-session";
import type { AgentSession, AgentSessionModel } from "../src/lib/agent-session";

const modelFor = (): AgentSessionModel => {
  const session: AgentSession = {
    fileType: "Codex",
    meta: { eventCount: 0, turnCount: 0 },
    events: [],
    parseWarnings: [],
    parseWarningCount: 0,
  };
  return createAgentSessionModel(session);
};

describe("useTrajectoryFilters", () => {
  it("keeps filter state across re-renders for the same model", () => {
    const model = modelFor();
    const { result, rerender } = renderHook(({ current }) => useTrajectoryFilters(current), {
      initialProps: { current: model },
    });

    act(() => {
      result.current.setQuery("shell");
      result.current.setKind("tool");
      result.current.setStatus("failed");
      result.current.setTimeRange({ start: 10, end: 20 });
    });
    rerender({ current: model });

    expect(result.current.query).toBe("shell");
    expect(result.current.kind).toBe("tool");
    expect(result.current.status).toBe("failed");
    expect(result.current.timeRange).toEqual({ start: 10, end: 20 });
  });

  it("resets every filter when the session model changes", () => {
    const { result, rerender } = renderHook(({ current }) => useTrajectoryFilters(current), {
      initialProps: { current: modelFor() },
    });

    act(() => {
      result.current.setQuery("shell");
      result.current.setKind("tool");
      result.current.setTimeRange({ start: 10, end: 20 });
    });
    rerender({ current: modelFor() });

    expect(result.current.query).toBe("");
    expect(result.current.kind).toBe("all");
    expect(result.current.timeRange).toBeNull();
  });

  it("clears all filters on demand", () => {
    const { result } = renderHook(() => useTrajectoryFilters(modelFor()));

    act(() => {
      result.current.setQuery("shell");
      result.current.setKind("user");
      result.current.setStatus("running");
      result.current.setTimeRange({ start: 1, end: 2 });
    });
    act(() => {
      result.current.clear();
    });

    expect(result.current.query).toBe("");
    expect(result.current.kind).toBe("all");
    expect(result.current.status).toBe("all");
    expect(result.current.timeRange).toBeNull();
  });
});
