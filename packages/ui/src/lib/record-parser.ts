import { parseJsonlRecordLine } from "@unquote/core";
import type { JsonlRecord } from "@unquote/core";
import type { RecordParserRequest, RecordParserResponse } from "../worker/record-parser-worker";
import { isWithinMainThreadBudget } from "./main-thread-budget";
import { createWorkerRequestRunner, type WorkerRequestRunner } from "./worker-lifecycle";

export const recordParserTimeoutMs = 15_000;
export const recordParserIdleTimeoutMs = 30_000;

export interface RecordParser {
  parse: (lines: Map<number, string>, signal?: AbortSignal) => Promise<Map<number, JsonlRecord>>;
  dispose: () => void;
}

interface RecordParserSlot {
  runner: WorkerRequestRunner;
  busy: boolean;
  cancelActive: ((reason: unknown) => void) | null;
  idleTimeoutId: number | null;
}

const parserAbortError = () => new DOMException("Full record parser disposed", "AbortError");

const parseOnMainThread = (lines: Map<number, string>) => {
  let codeUnits = 0;
  for (const line of lines.values()) {
    codeUnits += line.length;
    if (!isWithinMainThreadBudget(codeUnits * 2)) {
      throw new Error("Full record parsing requires a background worker for this input size");
    }
  }
  return new Map(
    [...lines].map(([lineNumber, line]) => [lineNumber, parseJsonlRecordLine(line, lineNumber)]),
  );
};

const createRecordParserRunner = () =>
  createWorkerRequestRunner(
    () =>
      new Worker(new URL("../worker/record-parser-worker.ts", import.meta.url), { type: "module" }),
  );

export const createRecordParser = (): RecordParser => {
  const slots: RecordParserSlot[] = [];
  let disposed = false;

  const acquireSlot = () => {
    let slot = slots.find((candidate) => !candidate.busy);
    if (!slot) {
      slot = {
        runner: createRecordParserRunner(),
        busy: false,
        cancelActive: null,
        idleTimeoutId: null,
      };
      slots.push(slot);
    }
    if (slot.idleTimeoutId !== null) {
      window.clearTimeout(slot.idleTimeoutId);
      slot.idleTimeoutId = null;
    }
    slot.busy = true;
    return slot;
  };

  const releaseSlot = (slot: RecordParserSlot) => {
    slot.busy = false;
    slot.cancelActive = null;
    if (!disposed) {
      slot.idleTimeoutId = window.setTimeout(() => {
        slot.idleTimeoutId = null;
        slot.runner.dispose();
      }, recordParserIdleTimeoutMs);
    }
  };

  const parse: RecordParser["parse"] = (lines, signal) => {
    if (signal?.aborted) {
      return Promise.reject(signal.reason);
    }
    if (disposed) {
      return Promise.reject(parserAbortError());
    }
    if (lines.size === 0) {
      return Promise.resolve(new Map());
    }

    const slot = acquireSlot();
    return new Promise<Map<number, JsonlRecord>>((resolve, reject) => {
      let settled = false;
      let abort: (() => void) | undefined;

      const settle = (complete: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        if (abort) {
          signal?.removeEventListener("abort", abort);
        }
        releaseSlot(slot);
        complete();
      };

      const run = slot.runner.begin<RecordParserResponse>({
        onMessage: ({ data }) => {
          if (data.requestId !== run.requestId || !run.finish()) {
            return;
          }
          if (data.type === "result") {
            settle(() => resolve(data.records));
          } else {
            settle(() => reject(new Error("Full record parsing failed")));
          }
        },
        onFailure: () => settle(() => reject(new Error("Full record worker failed"))),
      });

      const cancel = (reason: unknown) => {
        if (run.cancel()) {
          settle(() => reject(reason));
        }
      };
      slot.cancelActive = cancel;
      abort = () => cancel(signal?.reason);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) {
        abort();
        return;
      }

      if (!run.available) {
        run.finish();
        try {
          const records = parseOnMainThread(lines);
          settle(() => resolve(records));
        } catch (error) {
          settle(() => reject(error));
        }
        return;
      }
      if (run.post({ requestId: run.requestId, lines } satisfies RecordParserRequest)) {
        run.setTimeout(() => {
          if (run.cancel()) {
            settle(() => reject(new DOMException("Full record parsing timed out", "TimeoutError")));
          }
        }, recordParserTimeoutMs);
      }
    });
  };

  return {
    parse,
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const slot of slots) {
        if (slot.idleTimeoutId !== null) {
          window.clearTimeout(slot.idleTimeoutId);
          slot.idleTimeoutId = null;
        }
        slot.cancelActive?.(parserAbortError());
        slot.runner.dispose();
      }
      slots.length = 0;
    },
  };
};
