import { act, renderHook, waitFor } from "@testing-library/react";
import { parseInput, parsePreviewJsonlRecordLine } from "@unquote/core";
import type { ParseResult } from "@unquote/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useQueryInteraction } from "../src/hooks/use-query-interaction";
import { createLocalFileAccess } from "../src/lib/local-file-source";
import {
  createStreamingFileSourceRevision,
  createTextSourceRevision,
} from "../src/lib/published-source";
import type { PublishedSourceRevision } from "../src/lib/published-source";

const renderQuery = (source: PublishedSourceRevision, initialResult: ParseResult) =>
  renderHook(
    ({ result, source }) =>
      useQueryInteraction({
        source,
        resultRevision: source.sourceRevision,
        result,
        translateError: (reason) => reason,
      }),
    { initialProps: { result: initialResult, source } },
  );

describe("source-backed path queries", () => {
  beforeEach(() => vi.stubGlobal("Worker", undefined));
  afterEach(() => vi.unstubAllGlobals());

  it("finds paths in a local file even when the published records are previews", async () => {
    const text = JSON.stringify({ payload: JSON.stringify({ value: 42 }) });
    const access = createLocalFileAccess(new File([text], "session.jsonl"));
    const readRecords = vi.spyOn(access, "readRecords");
    const source = createStreamingFileSourceRevision(0, access, "jsonl");
    const { result } = renderQuery(source, {
      format: "jsonl",
      records: [parsePreviewJsonlRecordLine(text, 1)],
      stats: { total: 1, success: 1, failed: 0 },
    });

    act(() => result.current.intent.submitToolbarQuery(".payload.value"));

    await waitFor(() => expect(result.current.snapshot.pathMatchCount).toBe(1));
    expect(result.current.snapshot.pathError).toBeNull();
    expect(result.current.snapshot.recordsById.get("record-1")?.status).toBe("preview");
    expect(readRecords).not.toHaveBeenCalled();
    expect(result.current.navigation?.target).toEqual({
      kind: "path",
      sourceRevision: 0,
      target: {
        recordId: "record-1",
        pathText: "$.payload.value",
        rawKey: "value",
        stringifiedPathChain: ["$.payload"],
      },
    });
  });

  it("includes newly published records without resubmitting the path", async () => {
    const text = '{"payload":1}\n{"payload":2}';
    const source = createTextSourceRevision(0, text, "jsonl");
    const fullResult = parseInput(text, { forcedFormat: "jsonl" });
    const { result, rerender } = renderQuery(source, {
      ...fullResult,
      records: fullResult.records.slice(0, 1),
      stats: { total: 1, success: 1, failed: 0 },
    });

    act(() => result.current.intent.submitToolbarQuery("$.payload"));
    await waitFor(() => expect(result.current.snapshot.pathMatchCount).toBe(1));
    rerender({ source, result: fullResult });

    expect(result.current.snapshot.pathMatchCount).toBe(2);
    act(() => result.current.intent.nextResult());
    expect(result.current.navigation?.target).toMatchObject({
      kind: "path",
      target: { recordId: "record-2" },
    });
  });

  it("does not report a missing path while matching records are still being published", async () => {
    const text = '{"other":1}\n{"payload":2}';
    const source = createTextSourceRevision(0, text, "jsonl");
    const fullResult = parseInput(text, { forcedFormat: "jsonl" });
    const { result, rerender } = renderQuery(source, {
      ...fullResult,
      records: fullResult.records.slice(0, 1),
      stats: { total: 1, success: 1, failed: 0 },
    });
    act(() => result.current.intent.submitToolbarQuery("$.payload"));
    await waitFor(() => expect(result.current.snapshot.searchStatus).toBe("complete"));
    expect(result.current.snapshot.pathError).toBeNull();
    rerender({ source, result: fullResult });
    expect(result.current.snapshot.pathMatchCount).toBe(1);
  });

  it("distinguishes invalid paths from completed queries with no matches", async () => {
    const text = '{"payload":1}';
    const { result } = renderQuery(createTextSourceRevision(0, text, "json"), parseInput(text));
    act(() => result.current.intent.changeToolbarQuery("$.missing"));
    expect(result.current.snapshot.searchStatus).toBe("idle");
    expect(result.current.snapshot.pathError).toBeNull();

    act(() => result.current.intent.submitToolbarQuery("$.missing"));
    await waitFor(() => expect(result.current.snapshot.pathError).toBe("not-found"));

    act(() => result.current.intent.submitToolbarQuery("$["));
    expect(result.current.snapshot.pathError).toBe("invalid");
    expect(result.current.snapshot.searchStatus).toBe("idle");
  });

  it("materializes navigation outside the initial result window and resets for a new source", async () => {
    const text = Array.from({ length: 140 }, (_, i) => JSON.stringify({ payload: i })).join("\n");
    const source = createTextSourceRevision(0, text, "jsonl");
    const parsed = parseInput(text, { forcedFormat: "jsonl" });
    const { result, rerender } = renderQuery(source, parsed);
    act(() => result.current.intent.submitToolbarQuery("$.payload"));
    await waitFor(() => expect(result.current.snapshot.pathMatchCount).toBe(140));

    act(() => result.current.intent.previousResult());
    await waitFor(() =>
      expect(result.current.navigation?.target).toMatchObject({
        kind: "path",
        target: { recordId: "record-140", pathText: "$.payload" },
      }),
    );
    expect(result.current.snapshot.currentPathMatchIndex).toBe(139);

    rerender({ source: createTextSourceRevision(1, text, "jsonl"), result: parsed });
    expect(result.current.snapshot.pathMatchCount).toBe(0);
    expect(result.current.navigation).toBeNull();
  });
});
