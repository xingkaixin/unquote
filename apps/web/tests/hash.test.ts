import { compressToEncodedURIComponent } from "lz-string";
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

  it("round-trips normal input with the production codec", () => {
    const input = JSON.stringify({ message: "hello", nested: { ok: true } });
    const hash = createSourceHash(input);

    expect(hash).not.toBeNull();
    expect(getInitialInputFromHash(hash!)).toBe(input);
  });

  it("rejects oversized encoded input before decompression", () => {
    const decompress = vi.fn(() => '{"unsafe":true}');

    expect(getInitialInputFromHash(`${HASH_PREFIX}${"x".repeat(HASH_LIMIT + 1)}`, decompress)).toBe(
      "",
    );
    expect(decompress).not.toHaveBeenCalled();
  });

  it("rejects oversized decoded input", () => {
    const decompress = vi.fn(() => "x".repeat(HASH_RAW_INPUT_LIMIT + 1));

    expect(getInitialInputFromHash(`${HASH_PREFIX}encoded`, decompress)).toBe("");
  });

  it("rejects a small compressed value that expands past the raw limit", () => {
    const encoded = compressToEncodedURIComponent("x".repeat(HASH_RAW_INPUT_LIMIT + 1));

    expect(encoded.length).toBeLessThanOrEqual(HASH_LIMIT);
    expect(getInitialInputFromHash(`${HASH_PREFIX}${encoded}`)).toBe("");
  });

  it("accepts encoded and decoded values exactly at their limits", () => {
    const decoded = "x".repeat(HASH_RAW_INPUT_LIMIT);
    const decompress = vi.fn(() => decoded);

    expect(getInitialInputFromHash(`${HASH_PREFIX}${"x".repeat(HASH_LIMIT)}`, decompress)).toBe(
      decoded,
    );
    expect(decompress).toHaveBeenCalledTimes(1);
  });

  it("returns empty input for malformed compressed data", () => {
    expect(getInitialInputFromHash(`${HASH_PREFIX}invalid`, () => null)).toBe("");
    expect(
      getInitialInputFromHash(`${HASH_PREFIX}invalid`, () => {
        throw new Error("malformed");
      }),
    ).toBe("");
    expect(
      getInitialInputFromHash(
        HASH_PREFIX,
        vi.fn(() => "unexpected"),
      ),
    ).toBe("");
  });
});
