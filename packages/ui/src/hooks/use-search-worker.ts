import { useEffect, useRef, useState } from "react";
import type { LocalFileAccess } from "../lib/local-file-source";
import { parseTextResult } from "../lib/parse-text";
import { startPerfMeasure } from "../lib/perf";
import type { SourceRevision } from "../lib/source-revision";
import { isWithinMainThreadBudget } from "../lib/main-thread-budget";
import { searchRecords } from "../lib/record-search";
import type { SearchMatch, SearchOptions } from "../lib/record-search";
import { postToWorker, spawnWorker } from "../lib/worker-lifecycle";
import type { SearchRequest, SearchWorkerResponse } from "../worker/search-worker";

export const searchWorkerTimeoutMs = 5000;
export const largeFileSearchWorkerTimeoutMs = 15_000;
const largeFileSearchBytes = 1_000_000;

export type SearchWorkerStatus = "idle" | "pending" | "complete" | "error";
export type SearchWorkerErrorKind = "timeout" | "worker-error" | "too-large";

export interface SearchWorkerResult {
  sourceRevision: SourceRevision;
  matches: SearchMatch[] | null;
  status: SearchWorkerStatus;
  errorKind: SearchWorkerErrorKind | null;
}

const idleResult = (sourceRevision: SourceRevision): SearchWorkerResult => ({
  sourceRevision,
  matches: null,
  status: "idle",
  errorKind: null,
});
const pendingResult = (sourceRevision: SourceRevision): SearchWorkerResult => ({
  sourceRevision,
  matches: null,
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
): SearchRequest =>
  sourceAccess
    ? { type: "search-file", requestId, file: sourceAccess.getFile(), query, options }
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
      };

const getSearchWorkerTimeoutMs = (sourceAccess: LocalFileAccess | null) =>
  sourceAccess && sourceAccess.size > largeFileSearchBytes
    ? largeFileSearchWorkerTimeoutMs
    : searchWorkerTimeoutMs;

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
  const [state, setState] = useState<SearchWorkerResult>(() =>
    query ? pendingResult(sourceRevision) : idleResult(sourceRevision),
  );
  const requestIdRef = useRef(0);
  const workerRef = useRef<Worker | null>(null);
  const workerSourceRevisionRef = useRef<SourceRevision | null>(null);

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

    setState(pendingResult(sourceRevision));

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
        if (sourceAccess) {
          const controller = new AbortController();
          sourceAccess
            .search(query, options, controller.signal)
            .then((matches) => {
              finishRequestMeasure();
              if (!controller.signal.aborted && requestIdRef.current === requestId) {
                setState({ sourceRevision, matches, status: "complete", errorKind: null });
              }
            })
            .catch(() => {
              finishRequestMeasure();
              if (!controller.signal.aborted && requestIdRef.current === requestId) {
                setState({
                  sourceRevision,
                  matches: null,
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
          setState({ sourceRevision, matches: null, status: "error", errorKind: "too-large" });
          return;
        }

        const result = parseTextResult(text, forcedFormat);
        const matches = searchRecords(result.records, query, options);
        finishRequestMeasure();
        setState({
          sourceRevision,
          matches,
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
        setState({ sourceRevision, matches: null, status: "error", errorKind });
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
            matches: null,
            status: "error",
            errorKind: "worker-error",
          });
          return;
        }
        setState({
          sourceRevision,
          matches: response.matches,
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

    if (debounceMs > 0) {
      const debounceTimeoutId = window.setTimeout(dispatch, debounceMs);
      return () => {
        window.clearTimeout(debounceTimeoutId);
        dispatchCleanup?.();
      };
    }

    dispatch();
    return () => dispatchCleanup?.();
  }, [text, forcedFormat, sourceAccess, query, options, sourceRevision, debounceMs]);

  return inputsChanged
    ? query
      ? pendingResult(sourceRevision)
      : idleResult(sourceRevision)
    : state;
};
