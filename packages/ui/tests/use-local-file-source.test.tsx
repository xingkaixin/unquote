import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useLocalFileSource } from "../src/hooks/use-local-file-source";

const defaultOptions = { regex: false, caseSensitive: false, jq: false };

const makeStreamedFile = (contents: string, name = "payload.jsonl") => {
  const file = new File([contents], name, { type: "application/jsonl" });
  Object.defineProperty(file, "stream", {
    configurable: true,
    value: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(contents));
          controller.close();
        },
      }),
  });
  return file;
};

const makeDeferredRecord = (lineNumber: number) => ({
  id: `record-${lineNumber}`,
  lineNumber,
  node: {
    kind: "object" as const,
    value: null,
    path: ["$"],
    wasStringified: false,
    meta: {
      depth: 0,
      expandable: true,
      restorable: false,
      recordId: `record-${lineNumber}`,
      sourceLine: lineNumber,
    },
  },
  deferred: true,
  summary: "deferred",
});

describe("useLocalFileSource", () => {
  it("clears the hydration cache when the source file changes", async () => {
    const fileA = makeStreamedFile('{"a":1}\n');
    const fileB = makeStreamedFile('{"b":2}\n');

    const { result, rerender } = renderHook(
      ({ file }) => useLocalFileSource(file, "", defaultOptions),
      { initialProps: { file: fileA as File | null } },
    );

    act(() => {
      result.current.hydrateRecord(makeDeferredRecord(1));
    });
    await waitFor(() => expect(result.current.hydratedRecords.size).toBe(1));

    rerender({ file: fileB as File | null });
    await waitFor(() => expect(result.current.hydratedRecords.size).toBe(0));
  });

  it("de-duplicates in-flight hydration for the same line", async () => {
    const file = makeStreamedFile('{"a":1}\n');
    const { result } = renderHook(() => useLocalFileSource(file, "", defaultOptions));

    const record = makeDeferredRecord(1);
    act(() => {
      result.current.hydrateRecord(record);
      // Call again before the read resolves — must not double-read.
      result.current.hydrateRecord(record);
    });

    await waitFor(() => expect(result.current.hydratedRecords.size).toBe(1));
    expect(result.current.hydratedRecords.get(1)?.lineNumber).toBe(1);
  });

  it("does not hydrate non-deferred records", async () => {
    const file = makeStreamedFile('{"a":1}\n');
    const { result } = renderHook(() => useLocalFileSource(file, "", defaultOptions));

    const record = { ...makeDeferredRecord(1), deferred: false };
    act(() => {
      result.current.hydrateRecord(record);
    });

    // Give any pending read a chance to settle; the cache must stay empty.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.current.hydratedRecords.size).toBe(0);
  });

  it("debounces file search until the debounce window elapses", async () => {
    const file = makeStreamedFile('{"message":"needle"}\n');
    const { result, rerender } = renderHook(
      ({ query }) => useLocalFileSource(file, query, defaultOptions),
      { initialProps: { query: "" } },
    );

    rerender({ query: "needle" });
    // Before the debounce window, no search has run.
    expect(result.current.fileMatches).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(result.current.fileMatches).toBeNull();

    await waitFor(() => expect(result.current.fileMatches?.length).toBe(1));
  });

  it("aborts the previous search when the query changes mid-flight", async () => {
    const file = makeStreamedFile('{"message":"needle"}\n{"message":"other"}\n');
    const { result, rerender } = renderHook(
      ({ query }) => useLocalFileSource(file, query, defaultOptions),
      { initialProps: { query: "" } },
    );

    rerender({ query: "needle" });
    // Change the query before the first debounce window completes.
    await new Promise((resolve) => setTimeout(resolve, 100));
    rerender({ query: "other" });

    await waitFor(() => expect(result.current.fileMatches?.length).toBe(1));
    expect(result.current.fileMatches?.[0]?.recordId).toBe("record-2");
  });

  it("getFullRecords returns full records for a streamed source", async () => {
    const file = makeStreamedFile('{"a":1}\n{"b":2}\n');
    const { result } = renderHook(() => useLocalFileSource(file, "", defaultOptions));

    const full = await act(async () => {
      return result.current.getFullRecords([makeDeferredRecord(2)]);
    });

    expect(full.length).toBe(1);
    expect(full[0]?.lineNumber).toBe(2);
  });

  it("getFullRecords passes records through when there is no source file", async () => {
    const { result } = renderHook(() => useLocalFileSource(null, "", defaultOptions));

    const record = makeDeferredRecord(1);
    const full = await act(async () => {
      return result.current.getFullRecords([record]);
    });

    expect(full).toEqual([record]);
  });
});
