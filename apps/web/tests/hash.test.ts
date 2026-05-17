import { describe, expect, it, vi } from "vitest";
import {
  createSourceHash,
  getInitialInputFromHash,
  HASH_LIMIT,
  HASH_PREFIX,
  HASH_RAW_INPUT_LIMIT,
} from "../src/hash";

describe("web hash sync", () => {
  it("creates a data hash for small input", () => {
    const compress = vi.fn(() => "encoded");

    expect(createSourceHash('{"ok":true}', compress)).toBe(`${HASH_PREFIX}encoded`);
    expect(compress).toHaveBeenCalledWith('{"ok":true}');
  });

  it("skips empty and oversized raw input before compression", () => {
    const compress = vi.fn(() => "encoded");

    expect(createSourceHash("  ", compress)).toBeNull();
    expect(createSourceHash("a".repeat(HASH_RAW_INPUT_LIMIT + 1), compress)).toBeNull();
    expect(compress).not.toHaveBeenCalled();
  });

  it("skips compressed output that cannot fit in the hash budget", () => {
    const compress = vi.fn(() => "x".repeat(HASH_LIMIT + 1));

    expect(createSourceHash('{"large":true}', compress)).toBeNull();
  });

  it("reads data hash input", () => {
    const decompress = vi.fn(() => '{"ok":true}');

    expect(getInitialInputFromHash(`${HASH_PREFIX}encoded`, decompress)).toBe('{"ok":true}');
    expect(decompress).toHaveBeenCalledWith("encoded");
    expect(getInitialInputFromHash("#other=encoded", decompress)).toBe("");
  });
});
