import { describe, expect, it } from "vitest";
import {
  getPreviewMaxDepth,
  getPreviewPath,
  getPreviewPathSegments,
} from "../src/lib/record-preview";

describe("record preview", () => {
  it("formats preview keys as JSON paths", () => {
    expect(getPreviewPathSegments("payload.value")).toEqual([
      { kind: "key", value: "payload.value" },
    ]);
    expect(getPreviewPath("payload.value")).toBe('$["payload.value"]');
  });

  it("derives depth from scalar fields or container summaries", () => {
    expect(getPreviewMaxDepth({ fields: { event: "message" } })).toBe(1);
    expect(getPreviewMaxDepth({ fields: {}, containers: { payload: "object" } })).toBe(1);
    expect(getPreviewMaxDepth({ fields: {} })).toBe(0);
  });
});
