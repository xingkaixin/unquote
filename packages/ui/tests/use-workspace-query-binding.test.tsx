import { parseInput } from "@unquote/core";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useWorkspaceQueryBinding } from "../src/hooks/use-workspace-query-binding";
import type { SearchMatch } from "../src/lib/record-search";

const activeMatch: SearchMatch = {
  recordId: "record-2",
  pathText: "$.target",
  keyRanges: [],
  valueRanges: [],
  pathRanges: [],
  stringifiedPathChain: [],
};

describe("useWorkspaceQueryBinding", () => {
  it("applies query-to-workspace effects in protocol order", () => {
    const calls: string[] = [];
    const visibleRecords = parseInput('{"target":true}', { forcedFormat: "jsonl" }).records;
    const workspace = {
      state: {
        focusedPath: { recordId: "record-1", pathText: "$.focused" },
      },
      synchronizeSearchExpansions: vi.fn(() => {
        calls.push("search-expansions");
      }),
      clearFocus: vi.fn(() => {
        calls.push("focus");
      }),
      reconcileVisibleRecords: vi.fn(() => {
        calls.push("visible-records");
      }),
    };

    const { result, rerender } = renderHook(
      ({ match }) =>
        useWorkspaceQueryBinding({
          query: {
            activeSearchMatch: match,
            visibleMatches: [activeMatch],
            visibleRecords,
          },
          workspace,
        }),
      { initialProps: { match: activeMatch as SearchMatch | null } },
    );

    expect(result.current).toBe(activeMatch);
    expect(calls).toEqual(["search-expansions", "focus", "visible-records"]);

    rerender({ match: null });
    expect(result.current).toBeNull();
    expect(workspace.clearFocus).toHaveBeenCalledTimes(1);
  });
});
