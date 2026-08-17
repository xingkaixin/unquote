import { afterEach, describe, expect, it, vi } from "vitest";

interface WorkerScope {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
}

const defaultOptions = { regex: false, caseSensitive: false, jq: false };

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
      options: { ...defaultOptions, regex: true },
    });

    await vi.waitFor(() => expect(workerScope.postMessage).toHaveBeenCalledTimes(1));
    expect(workerScope.postMessage).toHaveBeenCalledWith({
      type: "result",
      requestId: 1,
      result: null,
    });
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
