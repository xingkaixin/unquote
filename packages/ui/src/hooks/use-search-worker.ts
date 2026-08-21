import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LocalFileAccess } from "../lib/local-file-source";
import { resolveSourceWork } from "../lib/published-source";
import type { SourceWorkProjection } from "../lib/published-source";
import { parseTextResult } from "../lib/parse-text";
import { startPerfMeasure } from "../lib/perf";
import { commitSourceRevisionResult } from "../lib/source-revision";
import type { SourceRevision } from "../lib/source-revision";
import { isWithinMainThreadBudget } from "../lib/main-thread-budget";
import { searchRecords } from "../lib/record-search";
import type { SearchOptions, SearchResultSet } from "../lib/record-search";
import { createWorkerRequest, spawnWorker } from "../lib/worker-lifecycle";
import type { WorkerRequest } from "../lib/worker-lifecycle";
import type { SearchRequest, SearchWorkerResponse } from "../worker/search-worker";

type LocalFileSearchAccess = Pick<LocalFileAccess, "getFile" | "search" | "size">;

export const searchWorkerTimeoutMs = 5000;
export const largeFileSearchWorkerTimeoutMs = 15_000;
const largeFileSearchBytes = 1_000_000;

export type SearchWorkerStatus = "idle" | "pending" | "complete" | "error";
export type SearchWorkerErrorKind =
  | "timeout"
  | "worker-error"
  | "too-large"
  | "regex-without-worker";

interface SearchIdentity {
  sourceRevision: SourceRevision;
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  jq: boolean;
}

interface SearchWorkerState extends SearchIdentity {
  result: SearchResultSet | null;
  status: SearchWorkerStatus;
  errorKind: SearchWorkerErrorKind | null;
}

type SearchWorkerStateUpdate =
  | SearchWorkerState
  | ((current: SearchWorkerState) => SearchWorkerState);

export interface SearchWorkerResult {
  sourceRevision: SourceRevision;
  result: SearchResultSet | null;
  status: SearchWorkerStatus;
  errorKind: SearchWorkerErrorKind | null;
  requestWindow: (matchIndexes: Float64Array) => void;
}

const createSearchIdentity = (
  sourceRevision: SourceRevision,
  query: string,
  options: SearchOptions,
): SearchIdentity => ({
  sourceRevision,
  query,
  regex: options.regex,
  caseSensitive: options.caseSensitive,
  jq: options.jq,
});

const hasSameSearchIdentity = (left: SearchIdentity, right: SearchIdentity) =>
  left.sourceRevision === right.sourceRevision &&
  left.query === right.query &&
  left.regex === right.regex &&
  left.caseSensitive === right.caseSensitive &&
  left.jq === right.jq;

const idleResult = (identity: SearchIdentity): SearchWorkerState => ({
  ...identity,
  result: null,
  status: "idle",
  errorKind: null,
});
const pendingResult = (identity: SearchIdentity): SearchWorkerState => ({
  ...identity,
  result: null,
  status: "pending",
  errorKind: null,
});
const completedResult = (
  identity: SearchIdentity,
  result: SearchResultSet | null,
): SearchWorkerState => ({ ...identity, result, status: "complete", errorKind: null });
const failedResult = (
  identity: SearchIdentity,
  errorKind: SearchWorkerErrorKind,
): SearchWorkerState => ({ ...identity, result: null, status: "error", errorKind });

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

interface SearchWindowRequest extends SearchIdentity {
  matchIndexes: Float64Array;
}

const hasSameIndexes = (left: Float64Array, right: Float64Array) => {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
};

export const useSearchWorker = (params: {
  source: SourceWorkProjection;
  query: string;
  options: SearchOptions;
  // Delay before a request is actually dispatched; only the last query
  // within the window fires. Defaults to 0 (dispatch immediately).
  debounceMs?: number;
}): SearchWorkerResult => {
  const { source, query, options: requestedOptions, debounceMs = 0 } = params;
  const { text, forcedFormat, sourceAccess, sourceRevision } = resolveSourceWork(source);
  const options = useMemo<SearchOptions>(
    () => ({
      regex: requestedOptions.regex,
      caseSensitive: requestedOptions.caseSensitive,
      jq: requestedOptions.jq,
    }),
    [requestedOptions.caseSensitive, requestedOptions.jq, requestedOptions.regex],
  );
  const searchIdentity = useMemo(
    () => createSearchIdentity(sourceRevision, query, options),
    [options, query, sourceRevision],
  );
  const [state, setState] = useState<SearchWorkerState>(() =>
    query ? pendingResult(searchIdentity) : idleResult(searchIdentity),
  );
  const commitState = useCallback((update: SearchWorkerStateUpdate) => {
    setState((current) =>
      commitSourceRevisionResult(current, typeof update === "function" ? update(current) : update),
    );
  }, []);
  const requestIdRef = useRef(0);
  const workerRef = useRef<Worker | null>(null);
  const workerSourceRevisionRef = useRef<SourceRevision | null>(null);
  const [windowRequest, setWindowRequest] = useState<SearchWindowRequest | null>(null);
  const activeWindowIndexes =
    windowRequest && hasSameSearchIdentity(windowRequest, searchIdentity)
      ? windowRequest.matchIndexes
      : undefined;
  const requestWindow = useCallback(
    (matchIndexes: Float64Array) => {
      if (matchIndexes.length === 0) {
        return;
      }
      const nextIndexes = Float64Array.from(matchIndexes);
      setWindowRequest((current) => {
        if (
          current &&
          hasSameSearchIdentity(current, searchIdentity) &&
          hasSameIndexes(current.matchIndexes, nextIndexes)
        ) {
          return current;
        }
        return {
          ...searchIdentity,
          matchIndexes: nextIndexes,
        };
      });
    },
    [searchIdentity],
  );

  useEffect(
    () => () => {
      const worker = workerRef.current;
      workerRef.current = null;
      workerSourceRevisionRef.current = null;
      worker?.terminate();
    },
    [],
  );

  useEffect(() => {
    if (!query) {
      requestIdRef.current += 1;
      commitState(idleResult(searchIdentity));
      return;
    }

    if (!activeWindowIndexes) {
      commitState(pendingResult(searchIdentity));
    }

    // The dispatched request's cleanup (worker listener/timeout, or the
    // fallback abort controller) doesn't exist until `dispatch` actually
    // runs, so it's captured here and the effect cleanup below tears down
    // whichever is active: the debounce timer, or the dispatched request.
    let dispatchCleanup: (() => void) | undefined;

    const dispatch = () => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      const finishRequestMeasure = startPerfMeasure("search:request");

      // Reached both when no Worker exists and when one fails to start: the
      // request still has to settle somewhere.
      const searchOnMainThread = () => {
        if (options.regex) {
          finishRequestMeasure();
          commitState(failedResult(searchIdentity, "regex-without-worker"));
          return;
        }

        if (sourceAccess) {
          const controller = new AbortController();
          sourceAccess
            .search(query, options, controller.signal, activeWindowIndexes)
            .then((result) => {
              finishRequestMeasure();
              if (!controller.signal.aborted && requestIdRef.current === requestId) {
                commitState(completedResult(searchIdentity, result));
              }
            })
            .catch(() => {
              finishRequestMeasure();
              if (!controller.signal.aborted && requestIdRef.current === requestId) {
                commitState(failedResult(searchIdentity, "worker-error"));
              }
            });
          dispatchCleanup = () => controller.abort();
          return;
        }

        // Parsing and searching in memory are both synchronous and cannot be
        // interrupted once started, so an oversized input is refused up front
        // instead of freezing the tab. The file path above already yields
        // between chunks.
        if (!isWithinMainThreadBudget(text.length)) {
          finishRequestMeasure();
          commitState(failedResult(searchIdentity, "too-large"));
          return;
        }

        const result = parseTextResult(text, forcedFormat);
        const searchResult = searchRecords(result.records, query, options, activeWindowIndexes);
        finishRequestMeasure();
        commitState(completedResult(searchIdentity, searchResult));
      };

      if (typeof Worker === "undefined") {
        searchOnMainThread();
        return;
      }

      const availableWorker =
        workerRef.current ??
        spawnWorker(
          () =>
            new Worker(new URL("../worker/search-worker.ts", import.meta.url), { type: "module" }),
        );
      if (!availableWorker) {
        searchOnMainThread();
        return;
      }
      const currentWorker: Worker = availableWorker;
      workerRef.current = currentWorker;

      const handleWorkerTermination = () => {
        if (workerRef.current === currentWorker) {
          workerRef.current = null;
          workerSourceRevisionRef.current = null;
        }
      };

      const commitFailure = (errorKind: SearchWorkerErrorKind) => {
        if (requestIdRef.current !== requestId) {
          return;
        }
        finishRequestMeasure();
        commitState(failedResult(searchIdentity, errorKind));
      };

      let workerRequest: WorkerRequest;

      function onMessage(event: MessageEvent<SearchWorkerResponse>) {
        const response = event.data;
        if (response.requestId !== requestIdRef.current || !workerRequest.finish()) {
          return;
        }
        finishRequestMeasure();

        if (response.type === "error") {
          if (workerRef.current === currentWorker) {
            workerSourceRevisionRef.current = null;
          }
          commitState(failedResult(searchIdentity, "worker-error"));
          return;
        }
        commitState(completedResult(searchIdentity, response.result));
      }

      workerRequest = createWorkerRequest(currentWorker, {
        onMessage,
        onFailure: () => commitFailure("worker-error"),
        onTerminate: handleWorkerTermination,
      });
      const sendText = !sourceAccess && workerSourceRevisionRef.current !== sourceRevision;
      const posted = workerRequest.post(
        buildSearchRequest(
          requestId,
          text,
          forcedFormat,
          sourceAccess,
          query,
          options,
          sourceRevision,
          sendText,
          activeWindowIndexes,
        ),
      );
      if (!posted) {
        return;
      }
      if (sendText) {
        workerSourceRevisionRef.current = sourceRevision;
      }

      workerRequest.setTimeout(() => {
        if (requestIdRef.current === requestId && workerRequest.terminate()) {
          commitFailure("timeout");
        }
      }, getSearchWorkerTimeoutMs(sourceAccess));

      dispatchCleanup = () => void workerRequest.terminate();
    };

    if (debounceMs > 0 && !activeWindowIndexes) {
      const debounceTimeoutId = window.setTimeout(dispatch, debounceMs);
      return () => {
        window.clearTimeout(debounceTimeoutId);
        dispatchCleanup?.();
      };
    }

    dispatch();
    return () => dispatchCleanup?.();
  }, [
    activeWindowIndexes,
    commitState,
    debounceMs,
    forcedFormat,
    options,
    query,
    searchIdentity,
    sourceAccess,
    sourceRevision,
    text,
  ]);

  const snapshot = hasSameSearchIdentity(state, searchIdentity)
    ? state
    : query
      ? pendingResult(searchIdentity)
      : idleResult(searchIdentity);
  return {
    sourceRevision: snapshot.sourceRevision,
    result: snapshot.result,
    status: snapshot.status,
    errorKind: snapshot.errorKind,
    requestWindow,
  };
};
