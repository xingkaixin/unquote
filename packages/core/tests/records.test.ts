import { describe, expect, it } from "vitest";
import {
  isFailedRecord,
  isFullRecord,
  isParsed,
  isPreviewRecord,
  parseJsonlRecordLine,
  parsePreviewJsonlRecordLine,
} from "../src";

describe("isParsed", () => {
  it("narrows full, preview, and failed records", () => {
    const full = parseJsonlRecordLine('{"ok":true}', 1);
    const preview = parsePreviewJsonlRecordLine('{"ok":true}', 2);
    const failed = parseJsonlRecordLine("{bad}", 3);

    expect(isParsed(full)).toBe(true);
    expect(isParsed(preview)).toBe(true);
    expect(isParsed(failed)).toBe(false);
    expect(isFullRecord(full)).toBe(true);
    expect(isPreviewRecord(preview)).toBe(true);
    expect(isFailedRecord(failed)).toBe(true);
  });
});
