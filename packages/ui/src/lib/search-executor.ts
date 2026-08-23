import type { LocalFileAccess } from "./local-file-source";
import { isWithinMainThreadBudget } from "./main-thread-budget";
import { parseTextResult } from "./parse-text-result";
import { startPerfMeasure } from "./perf";
import { searchRecords } from "./record-search";
import type { SearchOptions, SearchResultSet } from "./record-search";
import type { SearchErrorKind } from "./search-lifecycle";
import type { SourceRevision } from "./source-revision";
import { createWorkerRequestRunner } from "./worker-lifecycle";
import type { WorkerRun } from "./worker-lifecycle";
import type { SearchRequest, SearchWorkerResponse } from "../worker/search-worker";

type LocalFileSearchAccess = Pick<LocalFileAccess, "getFile" | "search" | "size">;

export const searchWorkerTimeoutMs = 5000;
export const largeFileSearchWorkerTimeoutMs = 15_000;
const largeFileSearchBytes = 1_000_000;

const buildSearchRequest = (
  requestId: number,
  text: string,
  forcedFormat: "json" | "jsonl" | undefined,
  sourceAccess: LocalFileSearchAccess | null,
  query: string,
  options: SearchOptions,
  sourceRevision: SourceRevision,
  sendText: boolean,
  windowIndexes?: Float64Array,
): SearchRequest =>
  sourceAccess
    ? {
        type: "search-file",
        requestId,
        sourceRevision,
        file: sourceAccess.getFile(),
        query,
        options,
        ...(windowIndexes ? { windowIndexes } : {}),
      }
    : {
        type: "search-text",
        requestId,
        source: sendText
          ? {
              kind: "content",
              sourceRevision,
              text,
              ...(forcedFormat ? { forcedFormat } : {}),
            }
          : { kind: "cached", sourceRevision },
        query,
        options,
        ...(windowIndexes ? { windowIndexes } : {}),
      };

const getSearchWorkerTimeoutMs = (sourceAccess: LocalFileSearchAccess | null) =>
  sourceAccess && sourceAccess.size > largeFileSearchBytes
    ? largeFileSearchWorkerTimeoutMs
    : searchWorkerTimeoutMs;

export interface SearchExecution {
  sourceRevision: SourceRevision;
  text: string;
  forcedFormat: "json" | "jsonl" | undefined;
  sourceAccess: LocalFileSearchAccess | null;
  query: string;
  options: SearchOptions;
  windowIndexes?: Float64Array;
}

export interface SearchExecutionCallbacks {
  onComplete: (result: SearchResultSet | null) => void;
  onFailure: (errorKind: SearchErrorKind) => void;
}

export interface SearchExecutor {
  run: (execution: SearchExecution, callbacks: SearchExecutionCallbacks) => () => void;
  invalidate: () => void;
  dispose: () => void;
}

export const createSearchExecutor = (): SearchExecutor => {
  const workerRunner = createWorkerRequestRunner(
    () => new Worker(new URL("../worker/search-worker.ts", import.meta.url), { type: "module" }),
  );
  let workerSourceRevision: SourceRevision | null = null;

  return {
    run(
      { sourceRevision, text, forcedFormat, sourceAccess, query, options, windowIndexes },
      { onComplete, onFailure },
    ) {
      const finishRequestMeasure = startPerfMeasure("search:request");
      const fail = (errorKind: SearchErrorKind) => {
        finishRequestMeasure();
        onFailure(errorKind);
      };

      let workerRun: WorkerRun;
      const onMessage = (event: MessageEvent<SearchWorkerResponse>) => {
        const response = event.data;
        if (response.requestId !== workerRun.requestId || !workerRun.finish()) {
          return;
        }
        finishRequestMeasure();
        if (response.type === "error") {
          workerSourceRevision = null;
          onFailure("worker-error");
        } else {
          onComplete(response.result);
        }
      };

      workerRun = workerRunner.begin({
        onMessage,
        onFailure: () => fail("worker-error"),
        onTerminate: () => {
          workerSourceRevision = null;
        },
      });

      let fallbackController: AbortController | undefined;
      const searchOnMainThread = () => {
        if (options.syntax === "regex") {
          workerRun.finish();
          fail("regex-without-worker");
          return;
        }
        if (sourceAccess) {
          fallbackController = new AbortController();
          sourceAccess
            .search(query, options, fallbackController.signal, windowIndexes)
            .then((result) => {
              finishRequestMeasure();
              if (!fallbackController?.signal.aborted && workerRun.finish()) {
                onComplete(result);
              }
            })
            .catch(() => {
              finishRequestMeasure();
              if (!fallbackController?.signal.aborted && workerRun.finish()) {
                onFailure("worker-error");
              }
            });
          return;
        }
        if (!isWithinMainThreadBudget(text.length)) {
          workerRun.finish();
          fail("too-large");
          return;
        }

        const result = parseTextResult(text, forcedFormat);
        const searchResult = searchRecords(result.records, query, options, windowIndexes);
        workerRun.finish();
        finishRequestMeasure();
        onComplete(searchResult);
      };

      if (!workerRun.available) {
        searchOnMainThread();
      } else {
        const sendText = !sourceAccess && workerSourceRevision !== sourceRevision;
        const posted = workerRun.post(
          buildSearchRequest(
            workerRun.requestId,
            text,
            forcedFormat,
            sourceAccess,
            query,
            options,
            sourceRevision,
            sendText,
            windowIndexes,
          ),
        );
        if (posted) {
          if (sendText) {
            workerSourceRevision = sourceRevision;
          }
          workerRun.setTimeout(() => {
            if (workerRun.cancel()) {
              fail("timeout");
            }
          }, getSearchWorkerTimeoutMs(sourceAccess));
        }
      }

      return () => {
        fallbackController?.abort();
        workerRun.cancel();
      };
    },
    invalidate() {
      workerRunner.invalidate();
    },
    dispose() {
      workerRunner.dispose();
      workerSourceRevision = null;
    },
  };
};
