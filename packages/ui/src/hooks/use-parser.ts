import type { ParseResult } from "@unquote/core";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { probeJsonl } from "@unquote/core";
import { toast } from "sonner";
import { useTranslation } from "../i18n/context";
import { parseText } from "../lib/parse-text";
import type { ParsedText, ParserProgress } from "../lib/parse-text";
import { markPerf, measurePerf } from "../lib/perf";
import type { LocalFileAccess } from "../lib/local-file-source";
import { resolveSourceWork } from "../lib/published-source";
import type { SourceWorkProjection } from "../lib/published-source";
import { belongsToSourceRevision } from "../lib/source-revision";
import type { SourceRevision } from "../lib/source-revision";
import type { RecordAppend } from "../lib/record-sequence";
import { isWithinMainThreadBudget } from "../lib/main-thread-budget";
import { createStreamPublisher } from "../lib/stream-publisher";
import { postToWorker, spawnWorker } from "../lib/worker-lifecycle";
import type { ParserRequest, ParserWorkerResponse } from "../worker/parser-worker";

const emptyResult = (forcedFormat?: "json" | "jsonl"): ParseResult => ({
  format: forcedFormat ?? "json",
  records: [],
  stats: { total: 0, success: 0, failed: 0 },
});

const idleProgress: ParserProgress = {
  processedLines: 0,
  success: 0,
  failed: 0,
  elapsedMs: 0,
  done: true,
};

const workerChunkSize = 256 * 1024;

export interface ParserSnapshot {
  sourceRevision: SourceRevision;
  result: ParseResult;
  progress: ParserProgress;
  agentSession: ParsedText["agentSession"];
  recordAppend: RecordAppend | null;
}

const pendingSnapshot = (
  sourceRevision: SourceRevision,
  forcedFormat: "json" | "jsonl" | undefined,
  sourceAccess: LocalFileAccess | null | undefined,
): ParserSnapshot => ({
  sourceRevision,
  result: sourceAccess ? emptyResult("jsonl") : emptyResult(forcedFormat),
  progress: { ...idleProgress, done: false },
  agentSession: null,
  recordAppend: null,
});

const parseFileOnMainThread = async (file: File): Promise<ParsedText> => {
  const text = await file.text();
  return parseText(text, { forcedFormat: "jsonl", fileName: file.name });
};

const shouldStreamJsonl = (input: string, forcedFormat?: "json" | "jsonl") => {
  if (forcedFormat === "jsonl") {
    return true;
  }
  if (forcedFormat === "json") {
    return false;
  }

  return probeJsonl(input).isLikelyJsonl;
};

export interface UseParserOptions {
  source: SourceWorkProjection;
}

export const useParser = ({ source }: UseParserOptions) => {
  const { text: input, forcedFormat, sourceAccess, sourceRevision } = resolveSourceWork(source);
  const { t } = useTranslation();
  const [mountParse] = useState(() => {
    // Mount-time parsing is synchronous too, so an oversized initial input
    // waits for the effect below rather than blocking the first paint.
    if (sourceAccess || !isWithinMainThreadBudget(input.length)) {
      return null;
    }

    return {
      sourceRevision,
      input,
      forcedFormat,
      parsed: parseText(input, { forcedFormat }),
    };
  });
  const [parserState, setParserState] = useState<ParserSnapshot>(() =>
    mountParse
      ? { sourceRevision, ...mountParse.parsed, recordAppend: null }
      : pendingSnapshot(sourceRevision, forcedFormat, sourceAccess),
  );
  const canReuseMountParseRef = useRef(mountParse !== null);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const sourceFile = sourceAccess?.getFile() ?? null;
  const reportFileReadError = useEffectEvent(() => {
    toast.error(t("input.readFailed"));
  });
  const reportInputTooLarge = useEffectEvent(() => {
    toast.error(t("input.tooLargeWithoutWorker"));
  });

  useEffect(() => {
    if (
      canReuseMountParseRef.current &&
      mountParse?.sourceRevision === sourceRevision &&
      mountParse.input === input &&
      mountParse.forcedFormat === forcedFormat &&
      !sourceAccess
    ) {
      return;
    }
    canReuseMountParseRef.current = false;

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    let settled = false;
    let dispatched = false;
    const isCurrentRequest = () => !settled && requestIdRef.current === requestId;

    const applyParsedText = ({ result, agentSession, progress }: ParsedText) => {
      setParserState({
        sourceRevision,
        result,
        agentSession,
        progress,
        recordAppend: null,
      });
    };

    const reportUnparsedSource = () => {
      setParserState({
        ...pendingSnapshot(sourceRevision, forcedFormat, sourceAccess),
        progress: idleProgress,
      });
      reportFileReadError();
    };

    const reportUnparsedSourceTooLarge = () => {
      setParserState({
        ...pendingSnapshot(sourceRevision, forcedFormat, sourceAccess),
        progress: idleProgress,
      });
      reportInputTooLarge();
    };

    // Reached both when no Worker exists and when one fails to start, accept a
    // message, or stay alive: every such request needs the same recoverable
    // terminal state instead of an unfinished parse.
    //
    // A synchronous parse cannot be preempted once it begins, so an oversized
    // input is refused before any work starts rather than freezing the tab.
    const parseOnMainThread = () => {
      settled = true;
      if (sourceFile) {
        if (!isWithinMainThreadBudget(sourceFile.size)) {
          reportUnparsedSourceTooLarge();
          return;
        }

        void parseFileOnMainThread(sourceFile)
          .then((parsed) => {
            if (requestIdRef.current === requestId) {
              applyParsedText(parsed);
            }
          })
          .catch(() => {
            if (requestIdRef.current === requestId) {
              reportUnparsedSource();
            }
          });
        return;
      }

      if (!isWithinMainThreadBudget(input.length)) {
        reportUnparsedSourceTooLarge();
        return;
      }

      applyParsedText(parseText(input, { forcedFormat }));
    };

    if (typeof Worker === "undefined") {
      parseOnMainThread();
      return;
    }

    const currentWorker = (workerRef.current ??= spawnWorker(
      () => new Worker(new URL("../worker/parser-worker.ts", import.meta.url), { type: "module" }),
    ));
    if (!currentWorker) {
      parseOnMainThread();
      return;
    }

    setParserState(pendingSnapshot(sourceRevision, forcedFormat, sourceAccess));
    markPerf("parse:start");
    let chunkTimeoutId: number | null = null;

    const publisher = createStreamPublisher<ParseResult["stats"], ParserProgress>(
      (records, stats, progress, recordAppend) => {
        setParserState((current) => ({
          sourceRevision,
          result: { format: "jsonl", records, stats },
          agentSession: belongsToSourceRevision(sourceRevision, current)
            ? current.agentSession
            : null,
          progress,
          recordAppend,
        }));
      },
    );

    // A worker that refuses work, raises an uncaught error, or sends an
    // undeserializable message is dropped so the next request builds a fresh
    // one, while this request still reaches exactly one terminal state.
    const abandonWorker = () => {
      if (workerRef.current === currentWorker) {
        workerRef.current = null;
      }
      currentWorker.terminate();
      if (!isCurrentRequest()) {
        return;
      }
      settled = true;
      if (chunkTimeoutId !== null) {
        window.clearTimeout(chunkTimeoutId);
      }
      publisher.cancel();
      reportUnparsedSource();
    };

    const post = (message: ParserRequest) => {
      if (postToWorker(currentWorker, message)) {
        dispatched = true;
        return true;
      }
      abandonWorker();
      return false;
    };

    const postJsonlChunks = () => {
      if (!post({ type: "start-jsonl", requestId })) {
        return;
      }
      let offset = 0;

      const postNextChunk = () => {
        if (requestIdRef.current !== requestId) {
          return;
        }

        const end = Math.min(input.length, offset + workerChunkSize);
        const posted = post({
          type: "jsonl-chunk",
          requestId,
          chunk: input.slice(offset, end),
          done: end >= input.length,
        });
        if (!posted) {
          return;
        }
        offset = end;

        if (offset < input.length) {
          chunkTimeoutId = window.setTimeout(postNextChunk, 0);
        }
      };

      postNextChunk();
    };

    const timeoutId = window.setTimeout(() => {
      if (sourceFile) {
        post({ type: "file-jsonl", requestId, file: sourceFile });
        return;
      }

      if (shouldStreamJsonl(input, forcedFormat)) {
        postJsonlChunks();
        return;
      }

      post(
        forcedFormat
          ? { type: "parse", requestId, input, forcedFormat }
          : { type: "parse", requestId, input },
      );
    }, 120);

    const onMessage = (event: MessageEvent<ParserWorkerResponse>) => {
      const message = event.data;
      if (settled || message.requestId !== requestIdRef.current) {
        return;
      }

      if (message.type === "batch") {
        if (!publisher.hasPublished()) {
          markPerf("parse:first-batch");
          measurePerf("parse:first-batch", "parse:start", "parse:first-batch");
        }
        publisher.pushBatch(message.records, message.stats, message.progress);
        return;
      }

      settled = true;
      publisher.flush();
      if (message.type === "error") {
        markPerf("parse:error");
        measurePerf("parse:error", "parse:start", "parse:error");
        setParserState((current) => ({
          sourceRevision,
          result: { ...current.result, format: "jsonl", stats: message.stats },
          agentSession: null,
          progress: message.progress,
          recordAppend: current.recordAppend,
        }));
        reportFileReadError();
        return;
      }

      markPerf("parse:complete");
      measurePerf("parse:complete", "parse:start", "parse:complete");
      if (message.type === "complete-result") {
        setParserState({
          sourceRevision,
          result: message.result,
          agentSession: message.agentSession,
          progress: message.progress,
          recordAppend: null,
        });
        return;
      }

      setParserState((current) => ({
        sourceRevision,
        result: { ...current.result, format: "jsonl", stats: message.stats },
        agentSession: message.agentSession,
        progress: message.progress,
        recordAppend: current.recordAppend,
      }));
    };

    currentWorker.addEventListener("message", onMessage);
    currentWorker.addEventListener("error", abandonWorker);
    currentWorker.addEventListener("messageerror", abandonWorker);
    return () => {
      const shouldTerminateWorker = dispatched && !settled && workerRef.current === currentWorker;
      settled = true;
      window.clearTimeout(timeoutId);
      if (chunkTimeoutId !== null) {
        window.clearTimeout(chunkTimeoutId);
      }
      publisher.cancel();
      currentWorker.removeEventListener("message", onMessage);
      currentWorker.removeEventListener("error", abandonWorker);
      currentWorker.removeEventListener("messageerror", abandonWorker);
      if (shouldTerminateWorker) {
        workerRef.current = null;
        currentWorker.terminate();
      }
    };
  }, [forcedFormat, input, mountParse, sourceAccess, sourceRevision]);

  // Terminate an idle worker when the hook's owner unmounts; active work is
  // terminated by the request cleanup above.
  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );

  return belongsToSourceRevision(sourceRevision, parserState)
    ? parserState
    : pendingSnapshot(sourceRevision, forcedFormat, sourceAccess);
};
