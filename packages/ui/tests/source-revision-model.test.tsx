import { describe, expect, it } from "vitest";
import { belongsToSourceRevision, shareSourceRevision } from "../src/lib/source-revision";

describe("source revision model", () => {
  it("accepts only derivations owned by the active Source Revision", () => {
    expect(belongsToSourceRevision(2, { sourceRevision: 2 })).toBe(true);
    expect(belongsToSourceRevision(2, { sourceRevision: 1 })).toBe(false);
    expect(shareSourceRevision(2, { sourceRevision: 2 }, { sourceRevision: 2 })).toBe(true);
    expect(shareSourceRevision(2, { sourceRevision: 2 }, { sourceRevision: 1 })).toBe(false);
  });
});
