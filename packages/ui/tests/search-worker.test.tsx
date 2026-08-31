import { afterEach, describe, expect, it, vi } from "vitest";
import { parseInput } from "@unquote/core";

interface WorkerScope {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
}

const defaultOptions = { syntax: "text", caseSensitive: false } as const;

const loadWorker = async () => {
  const workerScope: WorkerScope = { onmessage: null, postMessage: vi.fn() };
  vi.stubGlobal("self", workerScope);
  await import("../src/worker/search-worker");
  return workerScope;
};

const dispatch = (workerScope: WorkerScope, data: unknown) => {
  workerScope.onmessage?.({ data } as MessageEvent);
};

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

describe("search worker", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.restoreAllMocks();
    vi.doUnmock("../src/lib/record-search");
    vi.doUnmock("../src/lib/local-file-source");
    vi.doUnmock("../src/lib/parse-text-result");
  });

  it("finds matches in text input", async () => {
    const workerScope = await loadWorker();
    dispatch(workerScope, {
      type: "search-text",
      requestId: 1,
      source: {
        kind: "content",
        sourceRevision: 1,
        text: '{"a":"hello"}',
        forcedFormat: "json",
      },
      query: "hello",
      options: defaultOptions,
    });

    await vi.waitFor(() => expect(workerScope.postMessage).toHaveBeenCalledTimes(1));
    const [response] = workerScope.postMessage.mock.calls[0]!;
    expect(response).toMatchObject({ type: "result", requestId: 1 });
    expect(response.result.total).toBeGreaterThan(0);
    expect(response.result.window.matches.length).toBeGreaterThan(0);
  });

  it("reads only requested records when materializing a later memory-search window", async () => {
    const parsed = parseInput(
      Array.from({ length: 500 }, (_, index) => JSON.stringify({ value: `needle-${index}` })).join(
        "\n",
      ),
      { forcedFormat: "jsonl" },
    );
    let nodeReads = 0;
    for (const record of parsed.records) {
      const node = record.node;
      Object.defineProperty(record, "node", {
        get: () => {
          nodeReads += 1;
          return node;
        },
      });
    }
    vi.doMock("../src/lib/parse-text-result", () => ({ parseTextResult: () => parsed }));
    const scope = await loadWorker();
    dispatch(scope, {
      type: "search-text",
      requestId: 1,
      source: { kind: "content", sourceRevision: 1, text: "fixture" },
      query: "needle",
      options: defaultOptions,
    });
    expect(scope.postMessage.mock.calls[0]![0].result.total).toBe(500);
    expect(nodeReads).toBe(500);
    nodeReads = 0;
    dispatch(scope, {
      type: "search-text",
      requestId: 2,
      source: { kind: "cached", sourceRevision: 1 },
      query: "needle",
      options: defaultOptions,
      windowIndexes: Float64Array.from([128]),
    });
    const response = structuredClone(scope.postMessage.mock.calls[1]![0]);
    expect(nodeReads).toBe(1);
    expect(Object.keys(response).sort()).toEqual(["requestId", "type", "window"]);
    expect(response.type).toBe("window");
    expect(response.requestId).toBe(2);
    expect(Object.keys(response.window).sort()).toEqual(["matchIndexes", "matches"]);
    expect(Array.from(response.window.matchIndexes)).toEqual([128]);
    expect(response.window.matches).toMatchObject([{ recordId: "record-129" }]);
  });

  it("reuses parsed records for the same text across queries", async () => {
    const core = await import("@unquote/core");
    const parseSpy = vi.spyOn(core, "parseInput");
    const workerScope = await loadWorker();

    dispatch(workerScope, {
      type: "search-text",
      requestId: 1,
      source: {
        kind: "content",
        sourceRevision: 1,
        text: '{"a":"hello","b":"world"}',
        forcedFormat: "json",
      },
      query: "hello",
      options: defaultOptions,
    });
    await vi.waitFor(() => expect(workerScope.postMessage).toHaveBeenCalledTimes(1));
    dispatch(workerScope, {
      type: "search-text",
      requestId: 2,
      source: { kind: "cached", sourceRevision: 1 },
      query: "world",
      options: defaultOptions,
    });
    await vi.waitFor(() => expect(workerScope.postMessage).toHaveBeenCalledTimes(2));

    expect(parseSpy).toHaveBeenCalledTimes(1);
  });

  it("invalidates matches when new source content arrives", async () => {
    const scope = await loadWorker();
    for (const [revision, text] of [
      [1, '{"value":"needle"}'],
      [2, '{"value":"hay"}'],
    ] as const) {
      dispatch(scope, {
        type: "search-text",
        requestId: revision,
        source: { kind: "content", sourceRevision: revision, text },
        query: "needle",
        options: defaultOptions,
      });
    }
    expect(scope.postMessage.mock.calls[0]![0].result.total).toBe(1);
    expect(scope.postMessage.mock.calls[1]![0].result.total).toBe(0);
  });

  it("rejects a cached revision that was not loaded", async () => {
    const workerScope = await loadWorker();
    dispatch(workerScope, {
      type: "search-text",
      requestId: 1,
      source: { kind: "cached", sourceRevision: 9 },
      query: "hello",
      options: defaultOptions,
    });

    await vi.waitFor(() => expect(workerScope.postMessage).toHaveBeenCalledTimes(1));
    expect(workerScope.postMessage).toHaveBeenCalledWith({
      type: "error",
      requestId: 1,
      message: "Error",
    });
  });

  it("returns null matches for an invalid regex instead of erroring", async () => {
    const workerScope = await loadWorker();
    dispatch(workerScope, {
      type: "search-text",
      requestId: 1,
      source: {
        kind: "content",
        sourceRevision: 1,
        text: '{"a":"hello"}',
        forcedFormat: "json",
      },
      query: "(",
      options: { ...defaultOptions, syntax: "regex" },
    });

    await vi.waitFor(() => expect(workerScope.postMessage).toHaveBeenCalledTimes(1));
    expect(workerScope.postMessage).toHaveBeenCalledWith({
      type: "result",
      requestId: 1,
      result: null,
    });
  });

  it("releases the previous memory source when switching to a file", async () => {
    const scope = await loadWorker();
    dispatch(scope, {
      type: "search-text",
      requestId: 1,
      source: { kind: "content", sourceRevision: 1, text: '{"value":"needle"}' },
      query: "needle",
      options: defaultOptions,
    });
    dispatch(scope, {
      type: "search-file",
      requestId: 2,
      sourceRevision: 2,
      file: makeStreamedFile('{"value":"hay"}'),
      query: "needle",
      options: defaultOptions,
    });
    await vi.waitFor(() => expect(scope.postMessage).toHaveBeenCalledTimes(2));
    dispatch(scope, {
      type: "search-text",
      requestId: 3,
      source: { kind: "cached", sourceRevision: 1 },
      query: "needle",
      options: defaultOptions,
    });
    expect(scope.postMessage.mock.calls[2]![0]).toMatchObject({ type: "error", requestId: 3 });
  });

  it("finds matches in a streamed file", async () => {
    const file = makeStreamedFile('{"a":"hello"}\n{"a":"world"}\n');
    const workerScope = await loadWorker();
    dispatch(workerScope, {
      type: "search-file",
      requestId: 1,
      sourceRevision: 1,
      file,
      query: "world",
      options: defaultOptions,
    });

    await vi.waitFor(() => expect(workerScope.postMessage).toHaveBeenCalledTimes(1));
    const [response] = workerScope.postMessage.mock.calls[0]!;
    expect(response).toMatchObject({ type: "result", requestId: 1 });
    expect(response.result.window.matches.length).toBeGreaterThan(0);

    dispatch(workerScope, {
      type: "search-file",
      requestId: 2,
      sourceRevision: 1,
      file,
      query: "world",
      options: defaultOptions,
      windowIndexes: Float64Array.from([0]),
    });

    await vi.waitFor(() => expect(workerScope.postMessage).toHaveBeenCalledTimes(2));
    const windowResponse = structuredClone(workerScope.postMessage.mock.calls[1]![0]);
    expect(Object.keys(windowResponse).sort()).toEqual(["requestId", "type", "window"]);
    expect(windowResponse.type).toBe("window");
    expect(windowResponse.requestId).toBe(2);
    expect(Object.keys(windowResponse.window).sort()).toEqual(["matchIndexes", "matches"]);
    expect(Array.from(windowResponse.window.matchIndexes)).toEqual([0]);
    expect(windowResponse.window.matches).toMatchObject([{ recordId: "record-2" }]);
  });

  it("reuses file access for windows within one source revision", async () => {
    const result = {
      total: 0,
      matchLineNumbers: new Float64Array(),
      window: { matchIndexes: new Float64Array(), matches: [] },
    };
    const search = vi.fn().mockResolvedValue(result);
    const createLocalFileAccess = vi.fn(() => ({ search }));
    vi.doMock("../src/lib/local-file-source", () => ({ createLocalFileAccess }));
    const file = new File(["{}"], "payload.jsonl");
    const workerScope = await loadWorker();

    dispatch(workerScope, {
      type: "search-file",
      requestId: 1,
      sourceRevision: 4,
      file,
      query: "needle",
      options: defaultOptions,
    });
    await vi.waitFor(() => expect(workerScope.postMessage).toHaveBeenCalledTimes(1));
    dispatch(workerScope, {
      type: "search-file",
      requestId: 2,
      sourceRevision: 4,
      file,
      query: "needle",
      options: defaultOptions,
      windowIndexes: Float64Array.from([128]),
    });
    await vi.waitFor(() => expect(workerScope.postMessage).toHaveBeenCalledTimes(2));

    expect(createLocalFileAccess).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledTimes(2);

    dispatch(workerScope, {
      type: "search-file",
      requestId: 3,
      sourceRevision: 5,
      file,
      query: "needle",
      options: defaultOptions,
    });
    await vi.waitFor(() => expect(workerScope.postMessage).toHaveBeenCalledTimes(3));
    expect(createLocalFileAccess).toHaveBeenCalledTimes(2);
  });

  it("reports an error instead of empty matches when a file read fails", async () => {
    const file = makeFailingFile();
    const workerScope = await loadWorker();
    dispatch(workerScope, {
      type: "search-file",
      requestId: 1,
      sourceRevision: 1,
      file,
      query: "world",
      options: defaultOptions,
    });

    await vi.waitFor(() => expect(workerScope.postMessage).toHaveBeenCalledTimes(1));
    const [response] = workerScope.postMessage.mock.calls[0]!;
    expect(response.type).toBe("error");
    expect(response).not.toHaveProperty("result");
  });

  it("keeps error responses free of the input text and query", async () => {
    vi.doMock("../src/lib/record-search", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../src/lib/record-search")>();
      return {
        ...actual,
        searchRecords: () => {
          throw new Error("boom");
        },
      };
    });

    const workerScope = await loadWorker();
    dispatch(workerScope, {
      type: "search-text",
      requestId: 1,
      source: {
        kind: "content",
        sourceRevision: 1,
        text: '{"secret":"leak-me"}',
        forcedFormat: "json",
      },
      query: "leak-me",
      options: defaultOptions,
    });

    await vi.waitFor(() => expect(workerScope.postMessage).toHaveBeenCalledTimes(1));
    const [response] = workerScope.postMessage.mock.calls[0]!;
    expect(response.type).toBe("error");
    expect(response.message).not.toContain("leak-me");
    expect(response.message).not.toContain("secret");
  });
});
