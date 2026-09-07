import { type JsonlRecord, parseJsonlRecordLine, stringifyJsonNode } from "@unquote/core";
import { afterEach, expect, it, vi } from "vitest";
import { createLocalFileAccess } from "../src/lib/local-file-source";
import { mainThreadWorkBudgetBytes } from "../src/lib/main-thread-budget";
import type { RecordParserRequest } from "../src/worker/record-parser-worker";
import { MockWorkerEvents } from "./helpers/mock-worker-events";
import { createStreamFile } from "./helpers/stub-file";

class ControlledWorker extends MockWorkerEvents {
  postMessage = vi.fn<(request: RecordParserRequest) => void>();
  terminate = vi.fn(() => this.clearListeners());
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it("streams large records through the worker and waits for consumption before parsing the next", async () => {
  const line = `{"id":9007199254740993,"text":"${"x".repeat(mainThreadWorkBudgetBytes)}"}`;
  const first = parseJsonlRecordLine(line, 2);
  const second = parseJsonlRecordLine("1e2", 3);
  const worker = new ControlledWorker();
  vi.stubGlobal(
    "Worker",
    class {
      constructor() {
        return worker;
      }
    },
  );
  const { file } = createStreamFile(`ignored\n${line}\n1e2`, "large.jsonl");
  const access = createLocalFileAccess(file);
  let release!: () => void;
  const consumed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const onRecord = vi.fn(async (_record: JsonlRecord) => {
    await consumed;
  });
  try {
    const pending = access.streamRecords(new Set([2, 3]), onRecord);
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledOnce());
    expect(onRecord).not.toHaveBeenCalled();
    const request = worker.postMessage.mock.calls[0]![0];
    expect(request.lines).toEqual(new Map([[2, line]]));
    worker.respond({
      type: "result",
      requestId: request.requestId,
      records: new Map([[2, first]]),
    });
    await vi.waitFor(() => expect(onRecord).toHaveBeenCalledOnce());
    expect(worker.postMessage).toHaveBeenCalledOnce();
    release();
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2));
    const next = worker.postMessage.mock.calls[1]![0];
    worker.respond({ type: "result", requestId: next.requestId, records: new Map([[3, second]]) });
    await pending;
    expect(onRecord.mock.calls.map(([record]) => record)).toEqual([first, second]);
    if (first.status !== "full") throw new Error("Expected a full record");
    expect(stringifyJsonNode(first.node)).toBe(line);
  } finally {
    release();
    access.dispose();
  }
});

it("cancels a streamed parse without consuming its result", async () => {
  const worker = new ControlledWorker();
  vi.stubGlobal(
    "Worker",
    class {
      constructor() {
        return worker;
      }
    },
  );
  const { file } = createStreamFile("null", "cancel.jsonl");
  const access = createLocalFileAccess(file);
  const controller = new AbortController();
  const onRecord = vi.fn();
  try {
    const pending = access.streamRecords(new Set([1]), onRecord, controller.signal);
    const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledOnce());
    controller.abort();
    await assertion;
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(onRecord).not.toHaveBeenCalled();
  } finally {
    access.dispose();
  }
});
