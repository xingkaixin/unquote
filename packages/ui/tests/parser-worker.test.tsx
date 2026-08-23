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

describe("parser worker dispatch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("posts a complete-result response for whole-input parsing", async () => {
    const workerScope = await loadWorker();

    dispatch(workerScope, {
      type: "parse",
      requestId: 1,
      input: '{"value":1}',
      forcedFormat: "json",
    });

    expect(workerScope.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "complete-result",
        requestId: 1,
        result: expect.objectContaining({
          format: "json",
          stats: { total: 1, success: 1, failed: 0 },
        }),
        agentSession: null,
        progress: expect.objectContaining({ done: true }),
      }),
    );
  });

  it("completes deeply nested Agent output without failing the worker request", async () => {
    const nestedOutput = `${"[".repeat(7_000)}"ok"${"]".repeat(7_000)}`;
    const input = [
      '{"type":"session_meta","payload":{"session_id":"deep-worker"}}',
      `{"type":"response_item","payload":{"type":"function_call_output","output":${nestedOutput}}}`,
    ].join("\n");
    const workerScope = await loadWorker();

    dispatch(workerScope, { type: "parse", requestId: 1, input, forcedFormat: "jsonl" });

    const response = workerScope.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message.type === "complete-result");
    expect(workerScope.postMessage.mock.calls.map(([message]) => message.type)).toEqual([
      "agent-session-detected",
      "complete-result",
    ]);
    expect(response).toMatchObject({
      requestId: 1,
      result: { stats: { total: 2, success: 2, failed: 0 } },
      progress: { done: true },
    });
    expect(response.agentSession.events[1].conversationItems[0].block.text).toMatch(
      /\.\.\. \[truncated\]$/,
    );
    expect(workerScope.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "error" }),
    );
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
        elapsedMs: expect.any(Number),
        done: true,
      },
      error: expect.objectContaining({ name: "Error", message: "read failed" }),
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

  it("transfers Preview Records in compact form", async () => {
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
      status: "preview",
      preview: {
        fields: { type: "message", message: "ready", payload: '{"nested":true}' },
        nestedFieldKeys: ["payload"],
      },
    });
    expect(record.node?.children).toBeUndefined();
  });

  it("compacts container, nested, truncated, scalar, and invalid file records", async () => {
    const longString = "x".repeat(200);
    const chunk = [
      "{}",
      "[]",
      JSON.stringify({ object: {}, array: [] }),
      JSON.stringify({ first: "{}", second: "[]", long: longString }),
      JSON.stringify(longString),
      "null",
      "{bad}",
    ].join("\n");
    const reader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({ value: `${chunk}\n`, done: false })
        .mockResolvedValueOnce({ value: undefined, done: true }),
      cancel: vi.fn().mockResolvedValue(undefined),
    };
    const file = {
      name: "variants.jsonl",
      stream: () => ({
        pipeThrough: () => ({ getReader: () => reader }),
      }),
    } as unknown as File;

    const workerScope = await loadWorker();
    dispatch(workerScope, { type: "file-jsonl", requestId: 1, file });
    await vi.waitFor(() =>
      expect(workerScope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "complete-stats", requestId: 1 }),
      ),
    );

    const records = workerScope.postMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message.type === "batch")
      .flatMap((message) => message.records);
    expect(records).toHaveLength(7);
    expect(records[0]).not.toHaveProperty("preview");
    expect(records[0]?.node).toMatchObject({ kind: "object", childCount: 0, preview: true });
    expect(records[1]?.node).toMatchObject({ kind: "array", childCount: 0, preview: true });
    expect(records[2]?.preview).toEqual({
      fields: {},
      containers: { object: "object", array: "array" },
    });
    expect(records[3]?.preview).toMatchObject({
      nestedFieldKeys: ["first", "second"],
      fields: { first: "{}", second: "[]", long: "x".repeat(160) },
    });
    expect(records[4]?.node).toMatchObject({
      value: "x".repeat(160),
      valueLength: 200,
    });
    expect(records[5]).not.toHaveProperty("preview");
    expect(records[6]?.node).toBeNull();
    expect(records[6]?.status).toBe("failed");
  });

  it("parses each top-level file line once for records and agent tracking", async () => {
    const validLine = '{"value":1}';
    const invalidLine = "{bad}";
    const reader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({ value: `${validLine}\n${invalidLine}\n`, done: false })
        .mockResolvedValueOnce({ value: undefined, done: true }),
      cancel: vi.fn().mockResolvedValue(undefined),
    };
    const file = {
      name: "single-parse.jsonl",
      stream: () => ({
        pipeThrough: () => ({ getReader: () => reader }),
      }),
    } as unknown as File;
    const parse = vi.spyOn(JSON, "parse");
    const workerScope = await loadWorker();

    dispatch(workerScope, { type: "file-jsonl", requestId: 1, file });
    await vi.waitFor(() =>
      expect(workerScope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "complete-stats", requestId: 1 }),
      ),
    );

    expect(
      parse.mock.calls.filter(
        ([input]) =>
          input === validLine ||
          (typeof input === "string" &&
            input.startsWith('{"value":') &&
            input.includes("unquote:number1")),
      ),
    ).toHaveLength(1);
    expect(parse.mock.calls.filter(([input]) => input === invalidLine)).toHaveLength(1);
    parse.mockRestore();

    workerScope.postMessage.mockClear();
    dispatch(workerScope, {
      type: "jsonl-chunk",
      requestId: 1,
      chunk: '{"after":true}\n',
      done: true,
    });
    expect(workerScope.postMessage).not.toHaveBeenCalled();
  });

  it("streams JSONL chunks, skips blank lines, and completes with failure stats", async () => {
    const workerScope = await loadWorker();
    dispatch(workerScope, {
      type: "jsonl-chunk",
      requestId: 1,
      chunk: '{"ignored":true}\n',
      done: false,
    });
    expect(workerScope.postMessage).not.toHaveBeenCalled();

    dispatch(workerScope, { type: "start-jsonl", requestId: 2 });
    dispatch(workerScope, {
      type: "jsonl-chunk",
      requestId: 1,
      chunk: '{"stale":true}\n',
      done: false,
    });
    dispatch(workerScope, {
      type: "jsonl-chunk",
      requestId: 2,
      chunk: '\n{"ok":true}\n{bad}\n',
      done: true,
    });

    expect(workerScope.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "complete-stats",
        requestId: 2,
        stats: { total: 2, success: 1, failed: 1 },
      }),
    );

    workerScope.postMessage.mockClear();
    dispatch(workerScope, {
      type: "jsonl-chunk",
      requestId: 2,
      chunk: '{"after":true}\n',
      done: true,
    });
    expect(workerScope.postMessage).not.toHaveBeenCalled();
  });

  it("cancels a reader superseded after a successful read", async () => {
    let resolveRead: ((result: ReadableStreamReadResult<string>) => void) | undefined;
    const reader = {
      read: vi.fn(
        () =>
          new Promise<ReadableStreamReadResult<string>>((resolve) => {
            resolveRead = resolve;
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
    await vi.waitFor(() => expect(reader.read).toHaveBeenCalledOnce());
    dispatch(workerScope, { type: "parse", requestId: 2, input: "{}" });
    resolveRead?.({ value: '{"stale":true}\n', done: false });

    await vi.waitFor(() => expect(reader.cancel).toHaveBeenCalledOnce());
    expect(workerScope.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "batch", requestId: 1 }),
    );
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

  it("turns a throwing request into a terminal error response", async () => {
    vi.doMock("../src/lib/parse-text", async () => ({
      ...(await vi.importActual<typeof import("../src/lib/parse-text")>("../src/lib/parse-text")),
      parseText: () => {
        throw new RangeError("Invalid string length");
      },
    }));
    const workerScope = await loadWorker();

    dispatch(workerScope, { type: "parse", requestId: 1, input: "{}" });

    expect(workerScope.postMessage).toHaveBeenCalledWith({
      type: "error",
      requestId: 1,
      stats: { total: 0, success: 0, failed: 0 },
      progress: { elapsedMs: 0, done: true },
      error: expect.objectContaining({
        name: "RangeError",
        message: "Invalid string length",
      }),
    });
    vi.doUnmock("../src/lib/parse-text");
  });

  it("reports the streamed progress collected before a JSONL request throws", async () => {
    const jsonlLines =
      await vi.importActual<typeof import("../src/lib/jsonl-lines")>("../src/lib/jsonl-lines");
    vi.doMock("../src/lib/jsonl-lines", () => ({
      ...jsonlLines,
      drainJsonlLines: vi
        .fn(jsonlLines.drainJsonlLines)
        .mockImplementationOnce(jsonlLines.drainJsonlLines)
        .mockImplementationOnce(() => {
          throw new RangeError("Invalid string length");
        }),
    }));
    const workerScope = await loadWorker();

    dispatch(workerScope, { type: "start-jsonl", requestId: 1 });
    dispatch(workerScope, { type: "jsonl-chunk", requestId: 1, chunk: '{"a":1}\n', done: false });
    dispatch(workerScope, { type: "jsonl-chunk", requestId: 1, chunk: '{"b":2}\n', done: false });

    expect(workerScope.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "error",
        requestId: 1,
        stats: { total: 1, success: 1, failed: 0 },
        progress: expect.objectContaining({ done: true }),
      }),
    );
    vi.doUnmock("../src/lib/jsonl-lines");
  });
});
