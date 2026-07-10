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
    vi.doUnmock("../src/lib/tree");
  });

  it("finds matches in text input", async () => {
    const workerScope = await loadWorker();
    dispatch(workerScope, {
      type: "search-text",
      requestId: 1,
      text: '{"a":"hello"}',
      forcedFormat: "json",
      query: "hello",
      options: defaultOptions,
    });

    await vi.waitFor(() => expect(workerScope.postMessage).toHaveBeenCalledTimes(1));
    const [response] = workerScope.postMessage.mock.calls[0]!;
    expect(response).toMatchObject({ type: "result", requestId: 1 });
    expect(response.matches.length).toBeGreaterThan(0);
  });

  it("reuses parsed records for the same text across queries", async () => {
    const core = await import("@unquote/core");
    const parseSpy = vi.spyOn(core, "parseInput");
    const workerScope = await loadWorker();
    const request = (requestId: number, query: string) => ({
      type: "search-text" as const,
      requestId,
      text: '{"a":"hello","b":"world"}',
      forcedFormat: "json" as const,
      query,
      options: defaultOptions,
    });

    dispatch(workerScope, request(1, "hello"));
    await vi.waitFor(() => expect(workerScope.postMessage).toHaveBeenCalledTimes(1));
    dispatch(workerScope, request(2, "world"));
    await vi.waitFor(() => expect(workerScope.postMessage).toHaveBeenCalledTimes(2));

    expect(parseSpy).toHaveBeenCalledTimes(1);
  });

  it("returns null matches for an invalid regex instead of erroring", async () => {
    const workerScope = await loadWorker();
    dispatch(workerScope, {
      type: "search-text",
      requestId: 1,
      text: '{"a":"hello"}',
      forcedFormat: "json",
      query: "(",
      options: { ...defaultOptions, regex: true },
    });

    await vi.waitFor(() => expect(workerScope.postMessage).toHaveBeenCalledTimes(1));
    expect(workerScope.postMessage).toHaveBeenCalledWith({
      type: "result",
      requestId: 1,
      matches: null,
    });
  });

  it("finds matches in a streamed file", async () => {
    const file = makeStreamedFile('{"a":"hello"}\n{"a":"world"}\n');
    const workerScope = await loadWorker();
    dispatch(workerScope, {
      type: "search-file",
      requestId: 1,
      file,
      query: "world",
      options: defaultOptions,
    });

    await vi.waitFor(() => expect(workerScope.postMessage).toHaveBeenCalledTimes(1));
    const [response] = workerScope.postMessage.mock.calls[0]!;
    expect(response).toMatchObject({ type: "result", requestId: 1 });
    expect(response.matches.length).toBeGreaterThan(0);
  });

  it("reports an error instead of empty matches when a file read fails", async () => {
    const file = makeFailingFile();
    const workerScope = await loadWorker();
    dispatch(workerScope, {
      type: "search-file",
      requestId: 1,
      file,
      query: "world",
      options: defaultOptions,
    });

    await vi.waitFor(() => expect(workerScope.postMessage).toHaveBeenCalledTimes(1));
    const [response] = workerScope.postMessage.mock.calls[0]!;
    expect(response.type).toBe("error");
    expect(response).not.toHaveProperty("matches");
  });

  it("keeps error responses free of the input text and query", async () => {
    vi.doMock("../src/lib/tree", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../src/lib/tree")>();
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
      text: '{"secret":"leak-me"}',
      forcedFormat: "json",
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
