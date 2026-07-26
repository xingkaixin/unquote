import type { JsonlRecord } from "@unquote/core";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "../i18n/context";
import { fullRecordCacheLimit, type LocalFileAccess } from "../lib/local-file-source";
import { belongsToSourceRevision } from "../lib/source-revision";
import type { SourceRevision, SourceRevisionOwned } from "../lib/source-revision";

export interface LocalFileSource {
  resolveRecord: (record: JsonlRecord) => JsonlRecord;
  requestFullRecord: (record: JsonlRecord) => void;
  resolveRecords: (records: JsonlRecord[]) => Promise<JsonlRecord[]>;
}

interface FullRecordScope extends SourceRevisionOwned {
  access: LocalFileAccess | null;
  controller: AbortController;
  inFlightLines: Set<number>;
  // Lines queued by `requestFullRecord` calls in the current tick; merged into
  // one scan when the microtask flush runs. Lives on the scope (not a
  // standalone ref) so a source switch discards any not-yet-flushed batch too.
  pendingLines: Set<number>;
  flushScheduled: boolean;
}

interface FullRecordCache extends SourceRevisionOwned {
  recordsByLine: Map<number, JsonlRecord>;
}

const emptyFullRecordsByLine: ReadonlyMap<number, JsonlRecord> = new Map();

const createFullRecordScope = (
  access: LocalFileAccess | null,
  sourceRevision: SourceRevision,
): FullRecordScope => ({
  sourceRevision,
  access,
  controller: new AbortController(),
  inFlightLines: new Set(),
  pendingLines: new Set(),
  flushScheduled: false,
});

const createFullRecordCache = (sourceRevision: SourceRevision): FullRecordCache => ({
  sourceRevision,
  recordsByLine: new Map(),
});

/**
 * Deep module for local JSONL file source access.
 *
 * Owns the source-access concerns that leaked out of `UnquoteApp`:
 *  - Preview-to-Full Record cache (with in-flight de-dup + FIFO eviction)
 *  - Full Record resolution for copy / export
 *
 * Whole-file search uses the same `LocalFileAccess` capability through
 * `useSearchWorker`; this hook owns only browse-time record state.
 */
export const useLocalFileSource = (
  access: LocalFileAccess | null,
  sourceRevision: SourceRevision,
): LocalFileSource => {
  const { t } = useTranslation();
  const [fullRecordCache, setFullRecordCache] = useState<FullRecordCache>(() =>
    createFullRecordCache(sourceRevision),
  );
  // A revision-changing render runs before the layout-effect reset, so reject
  // the previous revision's cache on the read path too.
  const fullRecordsByLine = belongsToSourceRevision(sourceRevision, fullRecordCache)
    ? fullRecordCache.recordsByLine
    : emptyFullRecordsByLine;
  const fullRecordScopeRef = useRef<FullRecordScope>(createFullRecordScope(access, sourceRevision));

  // Replace the whole scope before browser events can request Full Records from
  // a newly committed source.
  useLayoutEffect(() => {
    const previous = fullRecordScopeRef.current;
    if (belongsToSourceRevision(sourceRevision, previous) && previous.access === access) {
      return;
    }

    previous.controller.abort();
    fullRecordScopeRef.current = createFullRecordScope(access, sourceRevision);
    setFullRecordCache(createFullRecordCache(sourceRevision));
  }, [access, sourceRevision]);

  useEffect(
    () => () => {
      fullRecordScopeRef.current.controller.abort();
    },
    [],
  );

  // Runs once per tick per scope: collects every line queued by
  // `requestFullRecord` since the last flush and resolves them with one scan
  // instead of one per record.
  const flushFullRecordScope = useCallback(
    (scope: FullRecordScope) => {
      scope.flushScheduled = false;
      if (fullRecordScopeRef.current !== scope || scope.controller.signal.aborted) {
        scope.pendingLines.clear();
        return;
      }

      const batch = scope.pendingLines;
      scope.pendingLines = new Set();
      if (batch.size === 0 || !scope.access) {
        return;
      }

      for (const lineNumber of batch) {
        scope.inFlightLines.add(lineNumber);
      }

      void scope.access
        .readRecords(batch, scope.controller.signal)
        .then((records) => {
          if (fullRecordScopeRef.current !== scope || scope.controller.signal.aborted) {
            return;
          }

          setFullRecordCache((current) => {
            if (fullRecordScopeRef.current !== scope) {
              return current;
            }

            const currentCacheBelongsToScope = belongsToSourceRevision(
              scope.sourceRevision,
              current,
            );
            const currentRecords = currentCacheBelongsToScope
              ? current.recordsByLine
              : new Map<number, JsonlRecord>();
            let next = currentRecords;
            for (const lineNumber of batch) {
              const fullRecord = records.get(lineNumber);
              if (!fullRecord || next.has(lineNumber)) {
                continue;
              }
              if (next === currentRecords) {
                next = new Map(currentRecords);
              }
              next.set(lineNumber, fullRecord);
            }
            // Eviction is FIFO, not LRU: `Map.keys()` yields insertion order and
            // the cache is only written when a Full Record resolves. Reads never
            // move a repeatedly viewed record to the back. That is a
            // deliberate trade — making it a true LRU would mean touching the
            // cache from the read path, which is a pure lookup today and would
            // otherwise re-render the whole record list on every scroll. Under
            // one-directional scrolling the two policies agree; the cost of the
            // difference is one extra scan when scrolling back past the limit,
            // after which the record is re-inserted at the back.
            while (next.size > fullRecordCacheLimit) {
              const firstInserted = next.keys().next().value;
              if (typeof firstInserted !== "number") {
                break;
              }
              next.delete(firstInserted);
            }
            if (currentCacheBelongsToScope && next === current.recordsByLine) {
              return current;
            }

            return { sourceRevision: scope.sourceRevision, recordsByLine: next };
          });
        })
        .catch(() => {
          if (fullRecordScopeRef.current === scope && !scope.controller.signal.aborted) {
            toast.error(t("input.readFailed"));
          }
        })
        .finally(() => {
          if (fullRecordScopeRef.current === scope) {
            // Clearing the in-flight marks also lets failed lines retry when
            // they scroll back into view.
            for (const lineNumber of batch) {
              scope.inFlightLines.delete(lineNumber);
            }
          }
        });
    },
    [t],
  );

  const requestFullRecord = useCallback(
    (record: JsonlRecord) => {
      if (!access || record.status !== "preview") {
        return;
      }

      const lineNumber = record.lineNumber;
      const scope = fullRecordScopeRef.current;
      if (
        !belongsToSourceRevision(sourceRevision, scope) ||
        scope.access !== access ||
        fullRecordsByLine.has(lineNumber) ||
        scope.inFlightLines.has(lineNumber) ||
        scope.pendingLines.has(lineNumber)
      ) {
        return;
      }

      scope.pendingLines.add(lineNumber);
      if (!scope.flushScheduled) {
        scope.flushScheduled = true;
        queueMicrotask(() => flushFullRecordScope(scope));
      }
    },
    [access, flushFullRecordScope, fullRecordsByLine, sourceRevision],
  );

  const resolveRecord = useCallback(
    (record: JsonlRecord) => fullRecordsByLine.get(record.lineNumber) ?? record,
    [fullRecordsByLine],
  );

  const resolveRecords = useCallback(
    (records: JsonlRecord[]) =>
      access ? access.resolveRecords(records) : Promise.resolve(records),
    [access],
  );

  return {
    resolveRecord,
    requestFullRecord,
    resolveRecords,
  };
};
