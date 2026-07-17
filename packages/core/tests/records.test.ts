import { describe, expect, it } from "vitest";
import { isParsed, parseDeferredJsonlRecordLine, parseJsonlRecordLine } from "../src";

describe("isParsed", () => {
  it("recognizes hydrated, deferred-only, and failed records", () => {
    const hydrated = parseJsonlRecordLine('{"ok":true}', 1);
    const deferredOnly = {
      ...parseDeferredJsonlRecordLine('{"ok":true}', 2),
      node: null,
    };
    const failed = parseJsonlRecordLine("{bad}", 3);

    expect(isParsed(hydrated)).toBe(true);
    expect(isParsed(deferredOnly)).toBe(true);
    expect(isParsed(failed)).toBe(false);
  });
});
