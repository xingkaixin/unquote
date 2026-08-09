import { describe, expect, it } from "vitest";
import { createLocalFileAccess } from "../src/lib/local-file-source";
import {
  createImportedFileSourceRevision,
  createStreamingFileSourceRevision,
  createTextSourceRevision,
  projectSourceImport,
  projectSourceView,
  projectSourceWork,
  resolveSourceWork,
} from "../src/lib/published-source";
import { belongsToSourceRevision, shareSourceRevision } from "../src/lib/source-revision";

describe("source revision model", () => {
  it("accepts only derivations owned by the active Source Revision", () => {
    expect(belongsToSourceRevision(2, { sourceRevision: 2 })).toBe(true);
    expect(belongsToSourceRevision(2, { sourceRevision: 1 })).toBe(false);
    expect(shareSourceRevision(2, { sourceRevision: 2 }, { sourceRevision: 2 })).toBe(true);
    expect(shareSourceRevision(2, { sourceRevision: 2 }, { sourceRevision: 1 })).toBe(false);
  });

  it("derives coherent work, import, and view projections from one published revision", () => {
    const textFile = new File(['{"value":1}'], "small.json");
    const imported = createImportedFileSourceRevision(3, textFile, '{"value":1}', "json");

    expect(resolveSourceWork(projectSourceWork(imported))).toEqual({
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
    expect(Object.isFrozen(projectSourceWork(imported))).toBe(true);
  });

  it("routes only streaming revisions through Local-file Source Access", () => {
    const file = new File(['{"value":1}\n'], "large.jsonl");
    const access = createLocalFileAccess(file);
    const streaming = createStreamingFileSourceRevision(4, access, "auto");
    const text = createTextSourceRevision(5, '{"value":1}', "auto");

    expect(projectSourceWork(streaming)).toMatchObject({
      kind: "local-file",
      sourceRevision: 4,
      access,
    });
    expect(resolveSourceWork(projectSourceWork(streaming))).toMatchObject({
      sourceRevision: 4,
      text: "",
      sourceAccess: access,
      forcedFormat: "jsonl",
    });
    expect(projectSourceWork(text)).toMatchObject({
      kind: "memory",
      sourceRevision: 5,
      text: '{"value":1}',
      forcedFormat: undefined,
    });
  });
});
