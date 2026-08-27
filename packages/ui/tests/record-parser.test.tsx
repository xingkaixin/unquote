import { parseJsonlRecordLine } from "@unquote/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseRecordLines, recordParserTimeoutMs } from "../src/lib/record-parser";
import { mainThreadWorkBudgetBytes } from "../src/lib/main-thread-budget";
import type { RecordParserRequest } from "../src/worker/record-parser-worker";
import { MockWorkerEvents } from "./helpers/mock-worker-events";

class ControlledWorker extends MockWorkerEvents {
  static instances: ControlledWorker[] = [];
  postMessage = vi.fn<(request: RecordParserRequest) => void>();
  terminate = vi.fn(() => this.clearListeners());
  constructor() {
    super();
    ControlledWorker.instances.push(this);
  }
}

const lines = new Map([[3, '{"value":9007199254740993}']]);
const expected = new Map([[3, parseJsonlRecordLine(lines.get(3)!, 3)]]);
const latestWorker = () => ControlledWorker.instances.at(-1)!;
const complete = (worker = latestWorker()) =>
  worker.respond({ type: "result", requestId: 1, records: expected });

describe("requested record parsing", () => {
  beforeEach(() => {
    ControlledWorker.instances = [];
    vi.stubGlobal("Worker", ControlledWorker);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends one batch to a worker without parsing it on the calling thread", async () => {
    const parse = vi.spyOn(JSON, "parse");
    const pending = parseRecordLines(lines);
    expect(latestWorker().postMessage).toHaveBeenCalledWith({ requestId: 1, lines });
    expect(parse).not.toHaveBeenCalled();
    complete();
    await expect(pending).resolves.toEqual(expected);
    expect(latestWorker().terminate).toHaveBeenCalledOnce();
  });

  it("ignores responses from a different request", async () => {
    const pending = parseRecordLines(lines);
    latestWorker().respond({ type: "result", requestId: 2, records: new Map() });
    expect(latestWorker().terminate).not.toHaveBeenCalled();
    complete();
    await expect(pending).resolves.toEqual(expected);
  });

  it("does not create a worker for an empty batch or a canceled request", async () => {
    await expect(parseRecordLines(new Map())).resolves.toEqual(new Map());
    const controller = new AbortController();
    controller.abort();
    await expect(parseRecordLines(lines, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(ControlledWorker.instances).toHaveLength(0);
  });

  it("terminates canceled work without interrupting other record batches", async () => {
    const controller = new AbortController();
    const first = parseRecordLines(lines, controller.signal);
    const firstWorker = latestWorker();
    const second = parseRecordLines(lines);
    controller.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(firstWorker.terminate).toHaveBeenCalledOnce();
    expect(latestWorker().terminate).not.toHaveBeenCalled();
    complete();
    await expect(second).resolves.toEqual(expected);
  });

  it("terminates parsing when its time budget expires", async () => {
    vi.useFakeTimers();
    const pending = parseRecordLines(lines);
    const assertion = expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(recordParserTimeoutMs);
    await assertion;
    expect(latestWorker().terminate).toHaveBeenCalledOnce();
  });

  it.each(["error", "messageerror"])(
    "rejects a worker %s without retrying synchronously",
    async (type) => {
      const parse = vi.spyOn(JSON, "parse");
      const pending = parseRecordLines(lines);
      latestWorker().dispatch(type, new Event(type));
      await expect(pending).rejects.toThrow("Full record worker failed");
      expect(parse).not.toHaveBeenCalled();
      expect(latestWorker().terminate).toHaveBeenCalledOnce();
    },
  );

  it("settles structured clone failures", async () => {
    vi.stubGlobal(
      "Worker",
      class extends ControlledWorker {
        override postMessage = vi.fn(() => {
          throw new DOMException("cannot clone", "DataCloneError");
        });
      },
    );
    await expect(parseRecordLines(lines)).rejects.toThrow("Full record worker failed");
    expect(latestWorker().terminate).toHaveBeenCalledOnce();
  });

  it("rejects worker-reported failures and releases the worker", async () => {
    const pending = parseRecordLines(lines);
    latestWorker().respond({ type: "error", requestId: 1 });
    await expect(pending).rejects.toThrow("Full record parsing failed");
    expect(latestWorker().terminate).toHaveBeenCalledOnce();
  });

  it.each(["absent", "construction-failed"])(
    "allows a bounded fallback when the worker is %s",
    async (mode) => {
      vi.stubGlobal(
        "Worker",
        mode === "absent"
          ? undefined
          : class {
              constructor() {
                throw new Error("blocked");
              }
            },
      );
      await expect(parseRecordLines(lines)).resolves.toEqual(expected);
    },
  );

  it("checks the entire fallback batch before parsing any records", async () => {
    vi.stubGlobal("Worker", undefined);
    const parse = vi.spyOn(JSON, "parse");
    const large = JSON.stringify("x".repeat(mainThreadWorkBudgetBytes / 4));
    await expect(
      parseRecordLines(
        new Map([
          [1, large],
          [2, large],
        ]),
      ),
    ).rejects.toThrow("requires a background worker");
    expect(parse).not.toHaveBeenCalled();
  });
});
