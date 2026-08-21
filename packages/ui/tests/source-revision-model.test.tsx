import { describe, expect, it } from "vitest";
import { createLocalFileAccess } from "../src/lib/local-file-source";
import {
  createImportedFileSourceRevision,
  createStreamingFileSourceRevision,
  createTextSourceRevision,
  projectSourceImport,
  projectSourceView,
  resolveSourceWork,
} from "../src/lib/published-source";
import {
  belongsToSourceRevision,
  commitSourceRevisionResult,
  createSourceRevisionState,
  readSourceRevisionState,
  replaceSourceRevisionState,
  shareSourceRevision,
  updateSourceRevisionState,
} from "../src/lib/source-revision";

describe("source revision model", () => {
  it("accepts only derivations owned by the active Source Revision", () => {
    expect(belongsToSourceRevision(2, { sourceRevision: 2 })).toBe(true);
    expect(belongsToSourceRevision(2, { sourceRevision: 1 })).toBe(false);
    expect(shareSourceRevision(2, { sourceRevision: 2 }, { sourceRevision: 2 })).toBe(true);
    expect(shareSourceRevision(2, { sourceRevision: 2 }, { sourceRevision: 1 })).toBe(false);
  });

  it("projects fresh state and rejects updates from obsolete revisions", () => {
    const first = createSourceRevisionState(1, { filter: "all" });
    const secondInitial = { filter: "all" };

    expect(readSourceRevisionState(2, first, secondInitial)).toBe(secondInitial);

    const second = updateSourceRevisionState(first, 2, secondInitial, () => ({
      filter: "message",
    }));
    const obsoleteUpdate = updateSourceRevisionState(second, 1, { filter: "all" }, () => ({
      filter: "tool",
    }));

    expect(second).toEqual({ sourceRevision: 2, value: { filter: "message" } });
    expect(obsoleteUpdate).toBe(second);
  });

  it("allows a future revision to be seeded while older seeds and results are rejected", () => {
    const current = createSourceRevisionState(2, "current");
    const future = replaceSourceRevisionState(current, 3, "seeded");

    expect(future).toEqual({ sourceRevision: 3, value: "seeded" });
    expect(replaceSourceRevisionState(future, 2, "obsolete")).toBe(future);
    expect(
      commitSourceRevisionResult(
        { sourceRevision: 3, status: "pending" },
        { sourceRevision: 2, status: "complete" },
      ),
    ).toEqual({ sourceRevision: 3, status: "pending" });
  });

  it("derives coherent work, import, and view projections from one published revision", () => {
    const textFile = new File(['{"value":1}'], "small.json");
    const imported = createImportedFileSourceRevision(3, textFile, '{"value":1}', "json");

    expect(resolveSourceWork(imported)).toEqual({
      sourceRevision: 3,
      text: '{"value":1}',
      sourceAccess: null,
      forcedFormat: "json",
    });
    expect(projectSourceImport(imported)).toEqual({
      draft: '{"value":1}',
      file: textFile,
      mode: "json",
    });
    expect(projectSourceView(imported)).toEqual({
      hasData: true,
      file: textFile,
      streamedFileName: null,
    });
    expect(Object.isFrozen(imported)).toBe(true);
  });

  it("routes only streaming revisions through Local-file Source Access", () => {
    const file = new File(['{"value":1}\n'], "large.jsonl");
    const access = createLocalFileAccess(file);
    const streaming = createStreamingFileSourceRevision(4, access, "auto");
    const text = createTextSourceRevision(5, '{"value":1}', "auto");

    expect(streaming).toMatchObject({
      kind: "local-file",
      sourceRevision: 4,
      access,
    });
    expect(resolveSourceWork(streaming)).toMatchObject({
      sourceRevision: 4,
      text: "",
      sourceAccess: access,
      forcedFormat: "jsonl",
    });
    expect(text).toMatchObject({
      kind: "memory",
      sourceRevision: 5,
      text: '{"value":1}',
      mode: "auto",
    });
  });
});
