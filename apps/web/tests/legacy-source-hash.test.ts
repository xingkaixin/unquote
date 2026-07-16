import { describe, expect, it, vi } from "vitest";
import { clearLegacySourceHash } from "../src/legacy-source-hash";

describe("legacy source hash cleanup", () => {
  it("removes a legacy source hash while preserving the path and query", () => {
    const replaceState = vi.fn();
    const state = { navigation: "preserved" };

    clearLegacySourceHash(
      { pathname: "/viewer", search: "?mode=json", hash: "#data=encoded-source" },
      { replaceState, state },
    );

    expect(replaceState).toHaveBeenCalledOnce();
    expect(replaceState).toHaveBeenCalledWith(state, "", "/viewer?mode=json");
  });

  it("leaves unrelated hashes unchanged", () => {
    const replaceState = vi.fn();

    clearLegacySourceHash(
      { pathname: "/viewer", search: "", hash: "#section" },
      { replaceState, state: null },
    );

    expect(replaceState).not.toHaveBeenCalled();
  });
});
