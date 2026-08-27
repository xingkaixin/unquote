import { parseJsonlRecordLine } from "@unquote/core";
import type { JsonlRecord } from "@unquote/core";
import type { RecordParserRequest, RecordParserResponse } from "../worker/record-parser-worker";
import { isWithinMainThreadBudget } from "./main-thread-budget";
import { createWorkerRequestRunner } from "./worker-lifecycle";

export const recordParserTimeoutMs = 15_000;

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

export const parseRecordLines = async (
  lines: Map<number, string>,
  signal?: AbortSignal,
): Promise<Map<number, JsonlRecord>> => {
  signal?.throwIfAborted();
  if (lines.size === 0) {
    return new Map();
  }

  const runner = createWorkerRequestRunner(
    () =>
      new Worker(new URL("../worker/record-parser-worker.ts", import.meta.url), { type: "module" }),
  );
  let abort: (() => void) | undefined;
  try {
    return await new Promise<Map<number, JsonlRecord>>((resolve, reject) => {
      const run = runner.begin<RecordParserResponse>({
        onMessage: ({ data }) => {
          if (data.requestId !== run.requestId || !run.finish()) {
            return;
          }
          if (data.type === "result") {
            resolve(data.records);
          } else {
            reject(new Error("Full record parsing failed"));
          }
        },
        onFailure: () => reject(new Error("Full record worker failed")),
      });
      abort = () => {
        if (run.cancel()) {
          reject(signal?.reason);
        }
      };
      signal?.addEventListener("abort", abort, { once: true });

      if (!run.available) {
        run.finish();
        resolve(parseOnMainThread(lines));
        return;
      }
      if (run.post({ requestId: run.requestId, lines } satisfies RecordParserRequest)) {
        run.setTimeout(() => {
          if (run.cancel()) {
            reject(new DOMException("Full record parsing timed out", "TimeoutError"));
          }
        }, recordParserTimeoutMs);
      }
    });
  } finally {
    if (abort) {
      signal?.removeEventListener("abort", abort);
    }
    runner.dispose();
  }
};
