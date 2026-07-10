import { useEffect, useRef, useState } from "react";
import { parseInput } from "@unquote/core";
import { searchJsonlFile } from "../lib/local-file-source";
import { searchRecords } from "../lib/tree";
import type { SearchMatch, SearchOptions } from "../lib/tree";
import type { SearchRequest, SearchWorkerResponse } from "../worker/search-worker";

export const searchWorkerTimeoutMs = 5000;

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

export const useSearchWorker = (params: {
  text: string;
  forcedFormat?: "json" | "jsonl";
  sourceFile: File | null;
  query: string;
  options: SearchOptions;
}): SearchWorkerResult => {
  const { text, forcedFormat, sourceFile, query, options } = params;
  const [state, setState] = useState<SearchWorkerResult>(idleResult);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!query) {
      requestIdRef.current += 1;
      setState(idleResult);
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setState(pendingResult);

    if (typeof Worker === "undefined") {
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
        return () => controller.abort();
      }

      const result = parseInput(text, forcedFormat ? { forcedFormat } : {});
      setState({
        matches: searchRecords(result.records, query, options),
        status: "complete",
        errorKind: null,
      });
      return;
    }

    workerRef.current ??= new Worker(new URL("../worker/search-worker.ts", import.meta.url), {
      type: "module",
    });
    const currentWorker = workerRef.current;
    currentWorker.postMessage(
      buildSearchRequest(requestId, text, forcedFormat, sourceFile, query, options),
    );

    const timeoutId = window.setTimeout(() => {
      if (requestIdRef.current !== requestId) {
        return;
      }
      currentWorker.terminate();
      workerRef.current = null;
      setState({ matches: null, status: "error", errorKind: "timeout" });
    }, searchWorkerTimeoutMs);

    const onMessage = (event: MessageEvent<SearchWorkerResponse>) => {
      const response = event.data;
      if (response.requestId !== requestIdRef.current) {
        return;
      }

      window.clearTimeout(timeoutId);
      if (response.type === "error") {
        setState({ matches: null, status: "error", errorKind: "worker-error" });
        return;
      }
      setState({ matches: response.matches, status: "complete", errorKind: null });
    };

    currentWorker.addEventListener("message", onMessage);
    return () => {
      window.clearTimeout(timeoutId);
      currentWorker.removeEventListener("message", onMessage);
    };
  }, [text, forcedFormat, sourceFile, query, options]);

  // Terminate the worker thread when the hook's owner unmounts; the per-request
  // cleanup above only detaches listeners and timers.
  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );

  return state;
};
