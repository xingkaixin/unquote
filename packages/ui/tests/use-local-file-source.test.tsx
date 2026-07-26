import { act, renderHook, waitFor } from "@testing-library/react";
import { materializeNode } from "@unquote/core";
import { describe, expect, it, vi } from "vitest";
import { useLocalFileSource } from "../src/hooks/use-local-file-source";
import { createLocalFileAccess, type LocalFileAccess } from "../src/lib/local-file-source";

const noopError = () => {};
const accessCache = new WeakMap<File, LocalFileAccess>();
const accessFor = (file: File | null) => {
  if (!file) {
    return null;
  }

  const cached = accessCache.get(file);
  if (cached) {
    return cached;
  }

  const access = createLocalFileAccess(file);
  accessCache.set(file, access);
  return access;
};

const isResolved = (source: ReturnType<typeof useLocalFileSource>, lineNumber: number) =>
  source.resolveRecord(makeDeferredRecord(lineNumber)).status !== "preview";

const makeStreamedFile = (contents: string, name = "payload.jsonl") => {
  const file = new File([contents], name, { type: "application/jsonl" });
  Object.defineProperty(file, "stream", {
    configurable: true,
    value: vi.fn(
      () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(contents));
            controller.close();
          },
        }),
    ),
  });
  return file;
};

// Yields `chunkSize` bytes per pull so a test can assert how far a scan read
// before stopping, instead of only whether it stopped.
const makeChunkedFile = (lineCount: number, chunkSize: number) => {
  const lines = Array.from(
    { length: lineCount },
    (_, index) => `{"n":"${String(index + 1).padStart(2, "0")}"}`,
  );
  const contents = lines.map((line) => `${line}\n`).join("");
  const bytes = new TextEncoder().encode(contents);
  const file = new File([contents], "chunked.jsonl", { type: "application/jsonl" });
  let bytesPulled = 0;
  const stream = vi.fn(() => {
    let offset = 0;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= bytes.length) {
          controller.close();
          return;
        }
        const end = Math.min(offset + chunkSize, bytes.length);
        const chunk = bytes.slice(offset, end);
        offset = end;
        bytesPulled += chunk.length;
        controller.enqueue(chunk);
      },
    });
  });
  Object.defineProperty(file, "stream", { configurable: true, value: stream });
  return { file, stream, totalBytes: bytes.length, bytesPulled: () => bytesPulled };
};

const makeFailingFile = (name = "payload.jsonl") => {
  const file = new File(['{"a":1}\n'], name, { type: "application/jsonl" });
  Object.defineProperty(file, "stream", {
    configurable: true,
    value: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error("io failure"));
        },
      }),
  });
  return file;
};

interface ControlledRead {
  delivered: boolean;
  resolve?: (result: ReadableStreamReadResult<Uint8Array>) => void;
  reject?: (error: unknown) => void;
  cancel: ReturnType<typeof vi.fn>;
}

const makeControlledFile = (contents: string, name: string) => {
  const reads: ControlledRead[] = [];
  const file = new File([contents], name, { type: "application/jsonl" });
  const stream = vi.fn(() => {
    const state: ControlledRead = {
      delivered: false,
      cancel: vi.fn(() => Promise.resolve()),
    };
    reads.push(state);
    return {
      getReader: () => ({
        read: () => {
          if (state.delivered) {
            return Promise.resolve({ done: true as const, value: undefined });
          }

          return new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
            state.resolve = resolve;
            state.reject = reject;
          });
        },
        cancel: state.cancel,
      }),
    };
  });
  Object.defineProperty(file, "stream", { configurable: true, value: stream });

  return {
    file,
    stream,
    reads,
    resolve(index = 0) {
      const state = reads[index]!;
      state.delivered = true;
      state.resolve?.({ done: false, value: new TextEncoder().encode(contents) });
    },
    reject(error: unknown, index = 0) {
      reads[index]!.reject?.(error);
    },
  };
};

const makeDeferredRecord = (lineNumber: number) => ({
  status: "preview" as const,
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
  summary: "deferred",
});

describe("useLocalFileSource", () => {
  it("keeps current hydration when a previous source resolves last", async () => {
    const sourceA = makeControlledFile('{"source":"A"}\n', "a.jsonl");
    const sourceB = makeControlledFile('{"source":"B"}\n', "b.jsonl");
    const { result, rerender } = renderHook(
      ({ file }) => useLocalFileSource(accessFor(file), noopError),
      {
        initialProps: { file: sourceA.file as File },
      },
    );

    act(() => result.current.requestRecord(makeDeferredRecord(1)));
    await act(async () => {}); // flush the microtask-batched read for source A
    rerender({ file: sourceB.file });
    act(() => result.current.requestRecord(makeDeferredRecord(1)));
    await act(async () => {}); // flush the microtask-batched read for source B
    expect(sourceA.reads[0]?.cancel).toHaveBeenCalledTimes(1);

    await act(async () => sourceB.resolve());
    await waitFor(() => expect(isResolved(result.current, 1)).toBe(true));
    expect(materializeNode(result.current.resolveRecord(makeDeferredRecord(1)).node!)).toEqual({
      source: "B",
    });

    await act(async () => sourceA.resolve());
    expect(materializeNode(result.current.resolveRecord(makeDeferredRecord(1)).node!)).toEqual({
      source: "B",
    });
  });

  it("does not report hydration failures from a previous source", async () => {
    const sourceA = makeControlledFile('{"source":"A"}\n', "a.jsonl");
    const sourceB = makeControlledFile('{"source":"B"}\n', "b.jsonl");
    const onError = vi.fn();
    const { result, rerender } = renderHook(
      ({ file }) => useLocalFileSource(accessFor(file), onError),
      { initialProps: { file: sourceA.file as File } },
    );

    act(() => result.current.requestRecord(makeDeferredRecord(1)));
    await act(async () => {}); // flush the microtask-batched read for source A
    rerender({ file: sourceB.file });
    await act(async () => sourceA.reject(new Error("stale failure")));

    expect(onError).not.toHaveBeenCalled();
  });

  it("does not let stale cleanup clear the current source in-flight line", async () => {
    const sourceA = makeControlledFile('{"source":"A"}\n', "a.jsonl");
    const sourceB = makeControlledFile('{"source":"B"}\n', "b.jsonl");
    const { result, rerender } = renderHook(
      ({ file }) => useLocalFileSource(accessFor(file), noopError),
      {
        initialProps: { file: sourceA.file as File },
      },
    );

    act(() => result.current.requestRecord(makeDeferredRecord(1)));
    await act(async () => {}); // flush the microtask-batched read for source A
    rerender({ file: sourceB.file });
    act(() => result.current.requestRecord(makeDeferredRecord(1)));
    await act(async () => {}); // flush the microtask-batched read for source B

    await act(async () => sourceA.resolve());
    expect(isResolved(result.current, 1)).toBe(false);
    act(() => result.current.requestRecord(makeDeferredRecord(1)));
    expect(sourceB.stream).toHaveBeenCalledTimes(1);

    await act(async () => sourceB.resolve());
    await waitFor(() => expect(isResolved(result.current, 1)).toBe(true));
  });

  it("clears the hydration cache when the source file changes", async () => {
    const fileA = makeStreamedFile('{"a":1}\n');
    const fileB = makeStreamedFile('{"b":2}\n');

    const { result, rerender } = renderHook(
      ({ file }) => useLocalFileSource(accessFor(file), noopError),
      { initialProps: { file: fileA as File | null } },
    );

    act(() => {
      result.current.requestRecord(makeDeferredRecord(1));
    });
    await waitFor(() => expect(isResolved(result.current, 1)).toBe(true));

    rerender({ file: fileB as File | null });
    await waitFor(() => expect(isResolved(result.current, 1)).toBe(false));
  });

  it("de-duplicates in-flight hydration for the same line", async () => {
    const file = makeStreamedFile('{"a":1}\n');
    const { result } = renderHook(() => useLocalFileSource(accessFor(file), noopError));

    const record = makeDeferredRecord(1);
    act(() => {
      result.current.requestRecord(record);
      // Call again before the read resolves — must not double-read.
      result.current.requestRecord(record);
    });

    await waitFor(() => expect(isResolved(result.current, 1)).toBe(true));
    expect(result.current.resolveRecord(record).lineNumber).toBe(1);
  });

  it("merges same-tick hydration requests into a single file scan", async () => {
    const file = makeStreamedFile('{"n":1}\n{"n":2}\n{"n":3}\n{"n":4}\n{"n":5}\n');
    const { result } = renderHook(() => useLocalFileSource(accessFor(file), noopError));

    act(() => {
      result.current.requestRecord(makeDeferredRecord(1));
      result.current.requestRecord(makeDeferredRecord(3));
      result.current.requestRecord(makeDeferredRecord(5));
    });

    await waitFor(() => expect(isResolved(result.current, 5)).toBe(true));
    expect(vi.mocked(file.stream)).toHaveBeenCalledTimes(1);
    expect(isResolved(result.current, 1)).toBe(true);
    expect(isResolved(result.current, 3)).toBe(true);
    expect(isResolved(result.current, 5)).toBe(true);
  });

  it("issues a separate file scan for hydration requests in a later tick", async () => {
    const file = makeStreamedFile('{"n":1}\n{"n":2}\n{"n":3}\n');
    const { result } = renderHook(() => useLocalFileSource(accessFor(file), noopError));

    act(() => {
      result.current.requestRecord(makeDeferredRecord(1));
    });
    await waitFor(() => expect(isResolved(result.current, 1)).toBe(true));

    act(() => {
      result.current.requestRecord(makeDeferredRecord(3));
    });
    await waitFor(() => expect(isResolved(result.current, 3)).toBe(true));

    expect(vi.mocked(file.stream)).toHaveBeenCalledTimes(2);
  });

  it("stops a merged scan at the farthest requested line instead of reading the whole file", async () => {
    const lineByteLength = 11; // `{"n":"01"}\n`
    const chunked = makeChunkedFile(50, 8);
    const { result } = renderHook(() => useLocalFileSource(accessFor(chunked.file), noopError));

    act(() => {
      result.current.requestRecord(makeDeferredRecord(2));
      result.current.requestRecord(makeDeferredRecord(45));
    });

    await waitFor(() => expect(isResolved(result.current, 45)).toBe(true));
    expect(chunked.stream).toHaveBeenCalledTimes(1);
    expect(chunked.bytesPulled()).toBeGreaterThanOrEqual(45 * lineByteLength);
    expect(chunked.bytesPulled()).toBeLessThan(chunked.totalBytes);
  });

  it("discards a pending batch entirely when the source switches before it flushes", async () => {
    const sourceA = makeControlledFile('{"n":1}\n{"n":2}\n', "a.jsonl");
    const sourceB = makeControlledFile('{"n":9}\n', "b.jsonl");
    const { result, rerender } = renderHook(
      ({ file }) => useLocalFileSource(accessFor(file), noopError),
      {
        initialProps: { file: sourceA.file as File },
      },
    );

    act(() => {
      result.current.requestRecord(makeDeferredRecord(1));
      result.current.requestRecord(makeDeferredRecord(2));
    });
    // Switch sources before the microtask flush for source A's batch runs.
    rerender({ file: sourceB.file });
    await act(async () => {});

    expect(sourceA.stream).not.toHaveBeenCalled();
    expect(isResolved(result.current, 1)).toBe(false);

    act(() => {
      result.current.requestRecord(makeDeferredRecord(1));
    });
    await act(async () => {}); // flush the microtask-batched read for source B
    await act(async () => sourceB.resolve());
    await waitFor(() => expect(isResolved(result.current, 1)).toBe(true));
    expect(materializeNode(result.current.resolveRecord(makeDeferredRecord(1)).node!)).toEqual({
      n: 9,
    });
  });

  it("reports one error for a failed batch and lets the whole batch retry", async () => {
    const file = makeFailingFile();
    const onError = vi.fn();
    const { result } = renderHook(() => useLocalFileSource(accessFor(file), onError));

    act(() => {
      result.current.requestRecord(makeDeferredRecord(1));
      result.current.requestRecord(makeDeferredRecord(2));
    });
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(isResolved(result.current, 1)).toBe(false);

    act(() => {
      result.current.requestRecord(makeDeferredRecord(1));
      result.current.requestRecord(makeDeferredRecord(2));
    });
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(2));
  });

  it("caps a merged batch at hydratedFileRecordLimit via FIFO eviction", async () => {
    const lineCount = 505;
    const contents = Array.from({ length: lineCount }, (_, index) => `{"n":${index + 1}}`).join(
      "\n",
    );
    const file = makeStreamedFile(`${contents}\n`);
    const { result } = renderHook(() => useLocalFileSource(accessFor(file), noopError));

    act(() => {
      for (let lineNumber = 1; lineNumber <= lineCount; lineNumber += 1) {
        result.current.requestRecord(makeDeferredRecord(lineNumber));
      }
    });

    await waitFor(() => expect(isResolved(result.current, lineCount)).toBe(true));
    expect(vi.mocked(file.stream)).toHaveBeenCalledTimes(1);
    expect(isResolved(result.current, 1)).toBe(false);
    expect(isResolved(result.current, 6)).toBe(true);
    expect(isResolved(result.current, lineCount)).toBe(true);
  });

  it("evicts by insertion order even for a just-requested record", async () => {
    const lineCount = 505;
    const contents = Array.from({ length: lineCount }, (_, index) => `{"n":${index + 1}}`).join(
      "\n",
    );
    const file = makeStreamedFile(`${contents}\n`);
    const { result } = renderHook(() => useLocalFileSource(accessFor(file), noopError));

    act(() => {
      for (let lineNumber = 1; lineNumber <= 500; lineNumber += 1) {
        result.current.requestRecord(makeDeferredRecord(lineNumber));
      }
    });
    await waitFor(() => expect(isResolved(result.current, 500)).toBe(true));

    act(() => {
      // Already cached, so this is a no-op that does not move line 1 to the
      // back of the map. A true LRU would keep it alive past the next batch.
      result.current.requestRecord(makeDeferredRecord(1));
      for (let lineNumber = 501; lineNumber <= lineCount; lineNumber += 1) {
        result.current.requestRecord(makeDeferredRecord(lineNumber));
      }
    });
    await waitFor(() => expect(isResolved(result.current, lineCount)).toBe(true));

    expect(isResolved(result.current, 1)).toBe(false);
    expect(isResolved(result.current, 6)).toBe(true);
  });

  it("does not hydrate non-deferred records", async () => {
    const file = makeStreamedFile('{"a":1}\n');
    const { result } = renderHook(() => useLocalFileSource(accessFor(file), noopError));

    const record = { ...makeDeferredRecord(1), status: "full" as const };
    act(() => {
      result.current.requestRecord(record);
    });

    // Give any pending read a chance to settle; the cache must stay empty.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(vi.mocked(file.stream)).not.toHaveBeenCalled();
  });

  it("resolveRecords returns full records for a streamed source", async () => {
    const file = makeStreamedFile('{"a":1}\n{"b":2}\n');
    const { result } = renderHook(() => useLocalFileSource(accessFor(file), noopError));

    const full = await act(async () => {
      return result.current.resolveRecords([makeDeferredRecord(2)]);
    });

    expect(full.length).toBe(1);
    expect(full[0]?.lineNumber).toBe(2);
  });

  it("reports hydration read failures and clears the in-flight mark", async () => {
    const file = makeFailingFile();
    const onError = vi.fn();
    const { result } = renderHook(() => useLocalFileSource(accessFor(file), onError));

    act(() => {
      result.current.requestRecord(makeDeferredRecord(1));
    });
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(isResolved(result.current, 1)).toBe(false);

    // The in-flight mark is cleared, so the same line can retry.
    act(() => {
      result.current.requestRecord(makeDeferredRecord(1));
    });
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(2));
  });

  it("resolveRecords passes records through when there is no source file", async () => {
    const { result } = renderHook(() => useLocalFileSource(null, noopError));

    const record = makeDeferredRecord(1);
    const full = await act(async () => {
      return result.current.resolveRecords([record]);
    });

    expect(full).toEqual([record]);
  });
});
