import { useCallback, useEffect, useMemo, useState } from "react";
import { resolveSourceWork } from "../lib/published-source";
import type { PublishedSourceRevision } from "../lib/published-source";
import type { SearchOptions, SearchResultSet } from "../lib/record-search";
import { createSearchExecutor } from "../lib/search-executor";
import type { SearchErrorKind, SearchStatus } from "../lib/search-lifecycle";
import { commitSourceRevisionResult } from "../lib/source-revision";
import type { SourceRevision } from "../lib/source-revision";

export { largeFileSearchWorkerTimeoutMs, searchWorkerTimeoutMs } from "../lib/search-executor";

interface SearchIdentity {
  sourceRevision: SourceRevision;
  query: string;
  syntax: SearchOptions["syntax"];
  caseSensitive: boolean;
}

interface SearchWorkerState extends SearchIdentity {
  result: SearchResultSet | null;
  status: SearchStatus;
  errorKind: SearchErrorKind | null;
}

type SearchWorkerStateUpdate =
  | SearchWorkerState
  | ((current: SearchWorkerState) => SearchWorkerState);

export interface SearchWorkerResult {
  sourceRevision: SourceRevision;
  result: SearchResultSet | null;
  status: SearchStatus;
  errorKind: SearchErrorKind | null;
  requestWindow: (matchIndexes: Float64Array) => void;
}

const createSearchIdentity = (
  sourceRevision: SourceRevision,
  query: string,
  options: SearchOptions,
): SearchIdentity => ({
  sourceRevision,
  query,
  syntax: options.syntax,
  caseSensitive: options.caseSensitive,
});

const hasSameSearchIdentity = (left: SearchIdentity, right: SearchIdentity) =>
  left.sourceRevision === right.sourceRevision &&
  left.query === right.query &&
  left.syntax === right.syntax &&
  left.caseSensitive === right.caseSensitive;

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
const failedResult = (identity: SearchIdentity, errorKind: SearchErrorKind): SearchWorkerState => ({
  ...identity,
  result: null,
  status: "error",
  errorKind,
});

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
  source: PublishedSourceRevision;
  query: string;
  options: SearchOptions;
  debounceMs?: number;
}): SearchWorkerResult => {
  const { source, query, options: requestedOptions, debounceMs = 0 } = params;
  const { text, forcedFormat, sourceAccess, sourceRevision } = resolveSourceWork(source);
  const options = useMemo<SearchOptions>(
    () => ({
      syntax: requestedOptions.syntax,
      caseSensitive: requestedOptions.caseSensitive,
    }),
    [requestedOptions.caseSensitive, requestedOptions.syntax],
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
  const [executor] = useState(createSearchExecutor);
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
        return { ...searchIdentity, matchIndexes: nextIndexes };
      });
    },
    [searchIdentity],
  );

  useEffect(() => () => executor.dispose(), [executor]);

  useEffect(() => {
    if (!query) {
      executor.invalidate();
      commitState(idleResult(searchIdentity));
      return;
    }
    if (!activeWindowIndexes) {
      commitState(pendingResult(searchIdentity));
    }

    let executionCleanup: (() => void) | undefined;
    const dispatch = () => {
      executionCleanup = executor.run(
        {
          sourceRevision,
          text,
          forcedFormat,
          sourceAccess,
          query,
          options,
          ...(activeWindowIndexes ? { windowIndexes: activeWindowIndexes } : {}),
        },
        {
          onComplete: (result) => commitState(completedResult(searchIdentity, result)),
          onFailure: (errorKind) => commitState(failedResult(searchIdentity, errorKind)),
        },
      );
    };

    if (debounceMs > 0 && !activeWindowIndexes) {
      const debounceTimeoutId = window.setTimeout(dispatch, debounceMs);
      return () => {
        window.clearTimeout(debounceTimeoutId);
        executionCleanup?.();
      };
    }

    dispatch();
    return () => executionCleanup?.();
  }, [
    activeWindowIndexes,
    commitState,
    debounceMs,
    executor,
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
