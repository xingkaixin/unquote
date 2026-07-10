import { afterEach, describe, expect, it, vi } from "vitest";

interface WorkerScope {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
}

const loadWorker = async () => {
  const workerScope: WorkerScope = { onmessage: null, postMessage: vi.fn() };
  vi.stubGlobal("self", workerScope);
  await import("../src/worker/parser-worker");
  return workerScope;
};

const dispatch = (workerScope: WorkerScope, data: unknown) => {
  workerScope.onmessage?.({ data } as MessageEvent);
};

describe("parser worker file dispatch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("cancels the reader and posts an error terminal response", async () => {
    const reader = {
      read: vi.fn().mockRejectedValue(new Error("read failed")),
      cancel: vi.fn().mockResolvedValue(undefined),
    };
    const file = {
      name: "broken.jsonl",
      stream: () => ({
        pipeThrough: () => ({ getReader: () => reader }),
      }),
    } as unknown as File;

    const workerScope = await loadWorker();
    dispatch(workerScope, { type: "file-jsonl", requestId: 1, file });
    await vi.waitFor(() => expect(reader.read).toHaveBeenCalledTimes(1));

    await vi.waitFor(() => expect(reader.cancel).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(workerScope.postMessage).toHaveBeenCalledTimes(1));
    expect(workerScope.postMessage).toHaveBeenCalledWith({
      type: "error",
      requestId: 1,
      stats: { total: 0, success: 0, failed: 0 },
      progress: {
        processedLines: 0,
        success: 0,
        failed: 0,
        elapsedMs: expect.any(Number),
        done: true,
      },
    });
  });

  it("posts an error when decoder stream setup fails", async () => {
    const file = {
      name: "broken.jsonl",
      stream: () => ({
        pipeThrough: () => {
          throw new Error("decoder failed");
        },
      }),
    } as unknown as File;

    const workerScope = await loadWorker();
    dispatch(workerScope, { type: "file-jsonl", requestId: 1, file });

    await vi.waitFor(() =>
      expect(workerScope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "error", requestId: 1 }),
      ),
    );
  });

  it("transfers deferred records as a compact preview", async () => {
    const reader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({
          value: '{"type":"message","message":"ready","payload":"{\\"nested\\":true}"}\n',
          done: false,
        })
        .mockResolvedValueOnce({ value: undefined, done: true }),
      cancel: vi.fn().mockResolvedValue(undefined),
    };
    const file = {
      name: "preview.jsonl",
      stream: () => ({
        pipeThrough: () => ({ getReader: () => reader }),
      }),
    } as unknown as File;

    const workerScope = await loadWorker();
    dispatch(workerScope, { type: "file-jsonl", requestId: 1, file });

    await vi.waitFor(() =>
      expect(workerScope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "batch", requestId: 1 }),
      ),
    );

    const batch = workerScope.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message.type === "batch");
    const record = batch.records[0];
    expect(record).toMatchObject({
      deferred: true,
      preview: {
        fields: { type: "message", message: "ready", payload: '{"nested":true}' },
        nestedFieldKeys: "payload",
      },
    });
    expect(record.node?.children).toBeUndefined();
  });

  it("cancels a stale reader without posting its rejection", async () => {
    let rejectRead: ((error: unknown) => void) | undefined;
    const reader = {
      read: vi.fn(
        () =>
          new Promise<ReadableStreamReadResult<string>>((_resolve, reject) => {
            rejectRead = reject;
          }),
      ),
      cancel: vi.fn().mockResolvedValue(undefined),
    };
    const file = {
      name: "old.jsonl",
      stream: () => ({
        pipeThrough: () => ({ getReader: () => reader }),
      }),
    } as unknown as File;

    const workerScope = await loadWorker();
    dispatch(workerScope, { type: "file-jsonl", requestId: 1, file });
    await vi.waitFor(() => expect(reader.read).toHaveBeenCalledTimes(1));
    dispatch(workerScope, { type: "parse", requestId: 2, input: "{}" });
    rejectRead?.(new Error("cancelled read"));

    await vi.waitFor(() => expect(reader.cancel).toHaveBeenCalledTimes(1));
    expect(workerScope.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "error", requestId: 1 }),
    );
  });
});
