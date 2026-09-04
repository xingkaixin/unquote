import { parseJsonlRecordLine } from "@unquote/core";
import type { JsonlRecord } from "@unquote/core";
import type { RecordParserRequest, RecordParserResponse } from "../worker/record-parser-worker";
import { isWithinMainThreadBudget } from "./main-thread-budget";
import { createWorkerRequestRunner } from "./worker-lifecycle";

export const recordParserTimeoutMs = 15_000;
export const recordParserIdleTimeoutMs = 30_000;

export interface RecordParser {
  parse: (lines: Map<number, string>, signal?: AbortSignal) => Promise<Map<number, JsonlRecord>>;
  dispose: () => void;
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
  const runner = createRecordParserRunner();
  const pending = new Set<() => void>();
  let disposed = false;
  let busy = false;
  let cancelActive: ((reason: unknown) => void) | null = null;
  let idleTimeoutId: number | null = null;

  const release = () => {
    busy = false;
    cancelActive = null;
    if (disposed) return;
    const next = pending.values().next().value;
    if (next) {
      next();
    } else {
      idleTimeoutId = window.setTimeout(() => {
        idleTimeoutId = null;
        runner.dispose();
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

    if (busy) {
      return new Promise((resolve, reject) => {
        const start = () => {
          pending.delete(start);
          signal?.removeEventListener("abort", abort);
          parse(lines, signal).then(resolve, reject);
        };
        const abort = () => {
          pending.delete(start);
          reject(signal?.reason);
        };
        pending.add(start);
        signal?.addEventListener("abort", abort, { once: true });
      });
    }
    if (idleTimeoutId !== null) {
      window.clearTimeout(idleTimeoutId);
      idleTimeoutId = null;
    }
    busy = true;
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
        release();
        complete();
      };

      const run = runner.begin<RecordParserResponse>({
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
      cancelActive = cancel;
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
      if (idleTimeoutId !== null) {
        window.clearTimeout(idleTimeoutId);
        idleTimeoutId = null;
      }
      cancelActive?.(parserAbortError());
      for (const start of pending) start();
      runner.dispose();
    },
  };
};
