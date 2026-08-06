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
      synchronizeSearchExpansions: vi.fn(() => {
        calls.push("search-expansions");
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
            visibleRecordAppend: null,
          },
          workspace,
        }),
      { initialProps: { match: activeMatch as SearchMatch | null } },
    );

    expect(result.current).toBe(activeMatch);
    expect(calls).toEqual(["search-expansions", "visible-records"]);
    expect(workspace.reconcileVisibleRecords).toHaveBeenCalledWith(visibleRecords, null);

    rerender({ match: null });
    expect(result.current).toBeNull();
  });
});
