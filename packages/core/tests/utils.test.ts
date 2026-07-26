import { describe, expect, it } from "vitest";
import { truncateAtCodePointBoundary } from "../src";

describe("truncateAtCodePointBoundary", () => {
  it("backs off when the limit splits a surrogate pair", () => {
    expect(truncateAtCodePointBoundary("abc😀tail", 4)).toBe("abc");
  });

  it("keeps a surrogate pair that ends at the limit", () => {
    expect(truncateAtCodePointBoundary("abc😀tail", 5)).toBe("abc😀");
  });

  it("does not remove an unpaired surrogate already present in the input", () => {
    expect(truncateAtCodePointBoundary("abc\ud83dx", 4)).toBe("abc\ud83d");
  });

  it("returns short values unchanged and handles a zero limit", () => {
    expect(truncateAtCodePointBoundary("😀", 10)).toBe("😀");
    expect(truncateAtCodePointBoundary("😀", 0)).toBe("");
  });
});
