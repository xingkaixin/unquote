import { describe, expect, it } from "vitest";
import {
  issueScrollIntent,
  resolvePathScrollIndex,
  resolveRecordScrollIndex,
  retainVisibleScrollIntent,
} from "../src/lib/scroll-intent";

describe("scroll intent", () => {
  it("reissues the same target with a fresh identity", () => {
    const target = { kind: "path", recordId: "record-1", pathText: "$.payload" } as const;
    const first = issueScrollIntent(target);
    const second = issueScrollIntent(target);

    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });

  it("invalidates targets hidden by record filtering", () => {
    const intent = issueScrollIntent({ kind: "record", recordId: "record-1" });

    expect(retainVisibleScrollIntent(intent, new Set(["record-2"]))).toBeNull();
    expect(retainVisibleScrollIntent(intent, new Set(["record-1"]))).toBe(intent);
  });

  it("resolves record and row destinations without DOM state", () => {
    const intent = issueScrollIntent({
      kind: "path",
      recordId: "record-2",
      pathText: "$.payload",
    });
    const records = [{ id: "record-1" }, { id: "record-2" }];
    const rows = [
      { kind: "node", source: { pathText: "$" } },
      { kind: "node", source: { pathText: "$.payload" } },
      { kind: "close", source: { pathText: "$.payload" } },
    ];

    expect(resolveRecordScrollIndex(records, intent)).toBe(1);
    expect(resolvePathScrollIndex(rows, "record-2", intent)).toBe(1);
    expect(resolvePathScrollIndex(rows, "record-1", intent)).toBe(-1);
  });
});
