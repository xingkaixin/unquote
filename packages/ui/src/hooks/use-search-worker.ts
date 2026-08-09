import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalFileAccess } from "../lib/local-file-source";
import { parseTextResult } from "../lib/parse-text";
import { startPerfMeasure } from "../lib/perf";
import type { SourceRevision } from "../lib/source-revision";
import { isWithinMainThreadBudget } from "../lib/main-thread-budget";
import { searchRecords } from "../lib/record-search";
import type { SearchOptions, SearchResultSet } from "../lib/record-search";
import { postToWorker, spawnWorker } from "../lib/worker-lifecycle";
import type { SearchRequest, SearchWorkerResponse } from "../worker/search-worker";

export const searchWorkerTimeoutMs = 5000;
export const largeFileSearchWorkerTimeoutMs = 15_000;
const largeFileSearchBytes = 1_000_000;

export type SearchWorkerStatus = "idle" | "pending" | "complete" | "error";
export type SearchWorkerErrorKind =
  | "timeout"
  | "worker-error"
  | "too-large"
  | "regex-without-worker";

interface SearchWorkerState {
  sourceRevision: SourceRevision;
  result: SearchResultSet | null;
  status: SearchWorkerStatus;
  errorKind: SearchWorkerErrorKind | null;
}

export interface SearchWorkerResult extends SearchWorkerState {
  requestWindow: (matchIndexes: Float64Array) => void;
}

const idleResult = (sourceRevision: SourceRevision): SearchWorkerState => ({
  sourceRevision,
  result: null,
  status: "idle",
  errorKind: null,
});
const pendingResult = (sourceRevision: SourceRevision): SearchWorkerState => ({
  sourceRevision,
  result: null,
  status: "pending",
  errorKind: null,
});

const buildSearchRequest = (
  requestId: number,
  text: string,
  forcedFormat: "json" | "jsonl" | undefined,
  sourceAccess: LocalFileAccess | null,
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

const getSearchWorkerTimeoutMs = (sourceAccess: LocalFileAccess | null) =>
  sourceAccess && sourceAccess.size > largeFileSearchBytes
    ? largeFileSearchWorkerTimeoutMs
    : searchWorkerTimeoutMs;

interface SearchWindowRequest {
  sourceRevision: SourceRevision;
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  jq: boolean;
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

const belongsToSearch = (
  request: SearchWindowRequest | null,
  sourceRevision: SourceRevision,
  query: string,
  options: SearchOptions,
) =>
  request?.sourceRevision === sourceRevision &&
  request.query === query &&
  request.regex === options.regex &&
  request.caseSensitive === options.caseSensitive &&
  request.jq === options.jq;

export const useSearchWorker = (params: {
  text: string;
  forcedFormat?: "json" | "jsonl";
  sourceAccess: LocalFileAccess | null;
  query: string;
  options: SearchOptions;
  sourceRevision: SourceRevision;
  // Delay before a request is actually dispatched; only the last query
  // within the window fires. Defaults to 0 (dispatch immediately).
  debounceMs?: number;
}): SearchWorkerResult => {
  const {
    text,
    forcedFormat,
    sourceAccess,
    query,
    options,
    sourceRevision,
    debounceMs = 0,
  } = params;
  // Seed both states from the mount-time inputs so the first render already
  // matches what the reconciliation below would otherwise compute one pass
  // later, avoiding a guaranteed extra render-phase setState on every mount.
  const [state, setState] = useState<SearchWorkerState>(() =>
    query ? pendingResult(sourceRevision) : idleResult(sourceRevision),
  );
  const requestIdRef = useRef(0);
  const workerRef = useRef<Worker | null>(null);
  const workerSourceRevisionRef = useRef<SourceRevision | null>(null);
  const [windowRequest, setWindowRequest] = useState<SearchWindowRequest | null>(null);
  const activeWindowIndexes =
    windowRequest && belongsToSearch(windowRequest, sourceRevision, query, options)
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
          belongsToSearch(current, sourceRevision, query, options) &&
          hasSameIndexes(current.matchIndexes, nextIndexes)
        ) {
          return current;
        }
        return {
          sourceRevision,
          query,
          regex: options.regex,
          caseSensitive: options.caseSensitive,
          jq: options.jq,
          matchIndexes: nextIndexes,
        };
      });
    },
    [options.caseSensitive, options.jq, options.regex, query, sourceRevision],
  );

  const [lastInputs, setLastInputs] = useState(() => ({
    text,
    forcedFormat,
    sourceAccess,
    query,
    options,
    sourceRevision,
  }));
  const inputsChanged =
    lastInputs.text !== text ||
    lastInputs.forcedFormat !== forcedFormat ||
    lastInputs.sourceAccess !== sourceAccess ||
    lastInputs.query !== query ||
    lastInputs.options !== options ||
    lastInputs.sourceRevision !== sourceRevision;
  // Reset state synchronously during render (not in the effect below) so no
  // committed render can ever pair new inputs with stale matches from a
  // prior source: record ids collide across sources, so a stale match
  // would otherwise highlight the wrong record for one frame.
  if (inputsChanged) {
    setLastInputs({ text, forcedFormat, sourceAccess, query, options, sourceRevision });
    setState(query ? pendingResult(sourceRevision) : idleResult(sourceRevision));
  }

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
      setState(idleResult(sourceRevision));
      return;
    }

    if (!activeWindowIndexes) {
      setState(pendingResult(sourceRevision));
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
          setState({
            sourceRevision,
            result: null,
            status: "error",
            errorKind: "regex-without-worker",
          });
          return;
        }

        if (sourceAccess) {
          const controller = new AbortController();
          sourceAccess
            .search(query, options, controller.signal, activeWindowIndexes)
            .then((result) => {
              finishRequestMeasure();
              if (!controller.signal.aborted && requestIdRef.current === requestId) {
                setState({ sourceRevision, result, status: "complete", errorKind: null });
              }
            })
            .catch(() => {
              finishRequestMeasure();
              if (!controller.signal.aborted && requestIdRef.current === requestId) {
                setState({
                  sourceRevision,
                  result: null,
                  status: "error",
                  errorKind: "worker-error",
                });
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
          setState({ sourceRevision, result: null, status: "error", errorKind: "too-large" });
          return;
        }

        const result = parseTextResult(text, forcedFormat);
        const searchResult = searchRecords(result.records, query, options, activeWindowIndexes);
        finishRequestMeasure();
        setState({
          sourceRevision,
          result: searchResult,
          status: "complete",
          errorKind: null,
        });
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
      // Re-bound after the null check because the hoisted lifecycle functions
      // below would otherwise not see the narrowed type.
      const currentWorker: Worker = availableWorker;
      workerRef.current = currentWorker;
      let timeoutId: number | undefined;
      let settled = false;

      function discardWorker() {
        if (workerRef.current === currentWorker) {
          workerRef.current = null;
          workerSourceRevisionRef.current = null;
        }
        currentWorker.terminate();
      }

      function finalizeRequest(terminateWorker: boolean) {
        if (settled) {
          return false;
        }
        settled = true;
        if (timeoutId !== undefined) {
          window.clearTimeout(timeoutId);
        }
        currentWorker.removeEventListener("message", onMessage);
        currentWorker.removeEventListener("error", onWorkerFailure);
        currentWorker.removeEventListener("messageerror", onWorkerFailure);
        if (terminateWorker) {
          discardWorker();
        }
        return true;
      }

      function failRequest(errorKind: SearchWorkerErrorKind) {
        if (requestIdRef.current !== requestId || !finalizeRequest(true)) {
          return;
        }
        finishRequestMeasure();
        setState({ sourceRevision, result: null, status: "error", errorKind });
      }

      // An uncaught worker error or an undeserializable message can leave the
      // cached parse behind, so the instance is dropped even when this request
      // already settled.
      function onWorkerFailure() {
        discardWorker();
        failRequest("worker-error");
      }

      function onMessage(event: MessageEvent<SearchWorkerResponse>) {
        const response = event.data;
        if (response.requestId !== requestIdRef.current || !finalizeRequest(false)) {
          return;
        }
        finishRequestMeasure();

        if (response.type === "error") {
          if (workerRef.current === currentWorker) {
            workerSourceRevisionRef.current = null;
          }
          setState({
            sourceRevision,
            result: null,
            status: "error",
            errorKind: "worker-error",
          });
          return;
        }
        setState({
          sourceRevision,
          result: response.result,
          status: "complete",
          errorKind: null,
        });
      }

      currentWorker.addEventListener("message", onMessage);
      currentWorker.addEventListener("error", onWorkerFailure);
      currentWorker.addEventListener("messageerror", onWorkerFailure);
      const sendText = !sourceAccess && workerSourceRevisionRef.current !== sourceRevision;
      const posted = postToWorker(
        currentWorker,
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
        failRequest("worker-error");
        return;
      }
      if (sendText) {
        workerSourceRevisionRef.current = sourceRevision;
      }

      timeoutId = window.setTimeout(
        () => failRequest("timeout"),
        getSearchWorkerTimeoutMs(sourceAccess),
      );

      dispatchCleanup = () => void finalizeRequest(true);
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
    debounceMs,
    forcedFormat,
    options,
    query,
    sourceAccess,
    sourceRevision,
    text,
  ]);

  const snapshot = inputsChanged
    ? query
      ? pendingResult(sourceRevision)
      : idleResult(sourceRevision)
    : state;
  return { ...snapshot, requestWindow };
};
