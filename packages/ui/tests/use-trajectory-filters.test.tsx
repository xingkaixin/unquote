import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useTrajectoryFilters } from "../src/hooks/use-trajectory-filters";

describe("useTrajectoryFilters", () => {
  it("keeps filter state across re-renders for the same Source Revision", () => {
    const { result, rerender } = renderHook(({ revision }) => useTrajectoryFilters(revision), {
      initialProps: { revision: 1 },
    });

    act(() => {
      result.current.setQuery("shell");
      result.current.setKind("tool");
      result.current.setStatus("failed");
      result.current.setTimeRange({ start: 10, end: 20 });
    });
    rerender({ revision: 1 });

    expect(result.current.query).toBe("shell");
    expect(result.current.kind).toBe("tool");
    expect(result.current.status).toBe("failed");
    expect(result.current.timeRange).toEqual({ start: 10, end: 20 });
  });

  it("resets every filter when the Source Revision changes", () => {
    const { result, rerender } = renderHook(({ revision }) => useTrajectoryFilters(revision), {
      initialProps: { revision: 1 },
    });

    act(() => {
      result.current.setQuery("shell");
      result.current.setKind("tool");
      result.current.setTimeRange({ start: 10, end: 20 });
    });
    rerender({ revision: 2 });

    expect(result.current.query).toBe("");
    expect(result.current.kind).toBe("all");
    expect(result.current.timeRange).toBeNull();
  });

  it("clears all filters on demand", () => {
    const { result } = renderHook(() => useTrajectoryFilters(1));

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
