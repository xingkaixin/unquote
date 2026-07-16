import { useEffect, useRef, useState } from "react";
import { parseInput } from "@unquote/core";
import { searchJsonlFile } from "../lib/local-file-source";
import { searchRecords } from "../lib/tree";
import type { SearchMatch, SearchOptions } from "../lib/tree";
import type { SearchRequest, SearchWorkerResponse } from "../worker/search-worker";

export const searchWorkerTimeoutMs = 5000;
export const largeFileSearchWorkerTimeoutMs = 15_000;
const largeFileSearchBytes = 1_000_000;

export type SearchWorkerStatus = "idle" | "pending" | "complete" | "error";

export interface SearchWorkerResult {
  matches: SearchMatch[] | null;
  status: SearchWorkerStatus;
  errorKind: "timeout" | "worker-error" | null;
}

const idleResult: SearchWorkerResult = { matches: null, status: "idle", errorKind: null };
const pendingResult: SearchWorkerResult = { matches: null, status: "pending", errorKind: null };

const buildSearchRequest = (
  requestId: number,
  text: string,
  forcedFormat: "json" | "jsonl" | undefined,
  sourceFile: File | null,
  query: string,
  options: SearchOptions,
): SearchRequest =>
  sourceFile
    ? { type: "search-file", requestId, file: sourceFile, query, options }
    : {
        type: "search-text",
        requestId,
        text,
        query,
        options,
        ...(forcedFormat ? { forcedFormat } : {}),
      };

const getSearchWorkerTimeoutMs = (sourceFile: File | null) =>
  sourceFile && sourceFile.size > largeFileSearchBytes
    ? largeFileSearchWorkerTimeoutMs
    : searchWorkerTimeoutMs;

export const useSearchWorker = (params: {
  text: string;
  forcedFormat?: "json" | "jsonl";
  sourceFile: File | null;
  query: string;
  options: SearchOptions;
  // Delay before a request is actually dispatched; only the last query
  // within the window fires. Defaults to 0 (dispatch immediately).
  debounceMs?: number;
}): SearchWorkerResult => {
  const { text, forcedFormat, sourceFile, query, options, debounceMs = 0 } = params;
  const [state, setState] = useState<SearchWorkerResult>(idleResult);
  const requestIdRef = useRef(0);
  const workerRef = useRef<Worker | null>(null);

  useEffect(
    () => () => {
      const worker = workerRef.current;
      workerRef.current = null;
      worker?.terminate();
    },
    [],
  );

  useEffect(() => {
    if (!query) {
      requestIdRef.current += 1;
      setState(idleResult);
      return;
    }

    setState(pendingResult);

    // The dispatched request's cleanup (worker listener/timeout, or the
    // fallback abort controller) doesn't exist until `dispatch` actually
    // runs, so it's captured here and the effect cleanup below tears down
    // whichever is active: the debounce timer, or the dispatched request.
    let dispatchCleanup: (() => void) | undefined;

    const dispatch = () => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;

      if (typeof Worker === "undefined") {
        if (options.regex) {
          setState({ matches: null, status: "error", errorKind: "worker-error" });
          return;
        }

        if (sourceFile) {
          const controller = new AbortController();
          searchJsonlFile(sourceFile, query, options, controller.signal)
            .then((matches) => {
              if (requestIdRef.current === requestId) {
                setState({ matches, status: "complete", errorKind: null });
              }
            })
            .catch(() => {
              if (requestIdRef.current === requestId) {
                setState({ matches: null, status: "error", errorKind: "worker-error" });
              }
            });
          dispatchCleanup = () => controller.abort();
          return;
        }

        const result = parseInput(text, forcedFormat ? { forcedFormat } : {});
        setState({
          matches: searchRecords(result.records, query, options),
          status: "complete",
          errorKind: null,
        });
        return;
      }

      const currentWorker =
        workerRef.current ??
        new Worker(new URL("../worker/search-worker.ts", import.meta.url), { type: "module" });
      workerRef.current = currentWorker;
      let timeoutId: number | undefined;
      let settled = false;

      function finalizeRequest(terminateWorker: boolean) {
        if (settled) {
          return false;
        }
        settled = true;
        if (timeoutId !== undefined) {
          window.clearTimeout(timeoutId);
        }
        currentWorker.removeEventListener("message", onMessage);
        if (terminateWorker && workerRef.current === currentWorker) {
          workerRef.current = null;
          currentWorker.terminate();
        }
        return true;
      }

      function onMessage(event: MessageEvent<SearchWorkerResponse>) {
        const response = event.data;
        if (response.requestId !== requestIdRef.current || !finalizeRequest(false)) {
          return;
        }

        if (response.type === "error") {
          setState({ matches: null, status: "error", errorKind: "worker-error" });
          return;
        }
        setState({ matches: response.matches, status: "complete", errorKind: null });
      }

      currentWorker.addEventListener("message", onMessage);
      currentWorker.postMessage(
        buildSearchRequest(requestId, text, forcedFormat, sourceFile, query, options),
      );

      timeoutId = window.setTimeout(() => {
        if (requestIdRef.current !== requestId || !finalizeRequest(true)) {
          return;
        }
        setState({ matches: null, status: "error", errorKind: "timeout" });
      }, getSearchWorkerTimeoutMs(sourceFile));

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
  }, [text, forcedFormat, sourceFile, query, options, debounceMs]);

  return state;
};
