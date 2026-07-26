import type { ParseResult } from "@unquote/core";
import { useEffect, useRef, useState } from "react";
import { probeJsonl } from "@unquote/core";
import { parseText } from "../lib/parse-text";
import type { ParsedText, ParserProgress } from "../lib/parse-text";
import { markPerf, measurePerf } from "../lib/perf";
import { belongsToSourceRevision } from "../lib/source-revision";
import type { SourceRevision } from "../lib/source-revision";
import { createStreamPublisher } from "../lib/stream-publisher";
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
}

const pendingSnapshot = (
  sourceRevision: SourceRevision,
  forcedFormat: "json" | "jsonl" | undefined,
  sourceFile: File | null | undefined,
): ParserSnapshot => ({
  sourceRevision,
  result: sourceFile ? emptyResult("jsonl") : emptyResult(forcedFormat),
  progress: { ...idleProgress, done: false },
  agentSession: null,
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
  input: string;
  forcedFormat?: "json" | "jsonl" | undefined;
  sourceFile?: File | null | undefined;
  onFileReadError?: (() => void) | undefined;
  sourceRevision: SourceRevision;
}

export const useParser = ({
  input,
  forcedFormat,
  sourceFile,
  onFileReadError,
  sourceRevision,
}: UseParserOptions) => {
  const [parserState, setParserState] = useState<ParserSnapshot>(() => {
    const { result, agentSession, progress } = parseText(input, { forcedFormat });
    return { sourceRevision, result, progress, agentSession };
  });
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const onFileReadErrorRef = useRef(onFileReadError);
  onFileReadErrorRef.current = onFileReadError;

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    if (typeof Worker === "undefined") {
      const applyMainThreadParse = ({ result, agentSession, progress }: ParsedText) => {
        setParserState({
          sourceRevision,
          result,
          agentSession,
          progress,
        });
      };

      if (sourceFile) {
        void parseFileOnMainThread(sourceFile)
          .then((parsed) => {
            if (requestIdRef.current === requestId) {
              applyMainThreadParse(parsed);
            }
          })
          .catch(() => {
            if (requestIdRef.current === requestId) {
              setParserState({
                ...pendingSnapshot(sourceRevision, forcedFormat, sourceFile),
                progress: idleProgress,
              });
              onFileReadErrorRef.current?.();
            }
          });
        return;
      }

      applyMainThreadParse(parseText(input, { forcedFormat }));
      return;
    }

    workerRef.current ??= new Worker(new URL("../worker/parser-worker.ts", import.meta.url), {
      type: "module",
    });

    const currentWorker = workerRef.current;
    setParserState(pendingSnapshot(sourceRevision, forcedFormat, sourceFile));
    markPerf("parse:start");
    let chunkTimeoutId: number | null = null;

    const publisher = createStreamPublisher<ParseResult["stats"], ParserProgress>(
      (records, stats, progress) => {
        setParserState((current) => ({
          sourceRevision,
          result: { format: "jsonl", records, stats },
          agentSession: belongsToSourceRevision(sourceRevision, current)
            ? current.agentSession
            : null,
          progress,
        }));
      },
    );

    const postJsonlChunks = () => {
      currentWorker.postMessage({ type: "start-jsonl", requestId } satisfies ParserRequest);
      let offset = 0;

      const postNextChunk = () => {
        if (requestIdRef.current !== requestId) {
          return;
        }

        const end = Math.min(input.length, offset + workerChunkSize);
        currentWorker.postMessage({
          type: "jsonl-chunk",
          requestId,
          chunk: input.slice(offset, end),
          done: end >= input.length,
        } satisfies ParserRequest);
        offset = end;

        if (offset < input.length) {
          chunkTimeoutId = window.setTimeout(postNextChunk, 0);
        }
      };

      postNextChunk();
    };

    const timeoutId = window.setTimeout(() => {
      if (sourceFile) {
        currentWorker.postMessage({
          type: "file-jsonl",
          requestId,
          file: sourceFile,
        } satisfies ParserRequest);
        return;
      }

      if (shouldStreamJsonl(input, forcedFormat)) {
        postJsonlChunks();
        return;
      }

      const message = forcedFormat
        ? ({ type: "parse", requestId, input, forcedFormat } satisfies ParserRequest)
        : ({ type: "parse", requestId, input } satisfies ParserRequest);
      currentWorker.postMessage(message);
    }, 120);

    const onMessage = (event: MessageEvent<ParserWorkerResponse>) => {
      const message = event.data;
      if (message.requestId !== requestIdRef.current) {
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

      publisher.flush();
      if (message.type === "error") {
        markPerf("parse:error");
        measurePerf("parse:error", "parse:start", "parse:error");
        setParserState((current) => ({
          sourceRevision,
          result: { ...current.result, format: "jsonl", stats: message.stats },
          agentSession: null,
          progress: message.progress,
        }));
        onFileReadErrorRef.current?.();
        return;
      }

      markPerf("parse:complete");
      measurePerf("parse:complete", "parse:start", "parse:complete");
      if (message.result) {
        setParserState({
          sourceRevision,
          result: message.result!,
          agentSession: message.agentSession ?? null,
          progress: message.progress,
        });
        return;
      }
      if (message.stats) {
        setParserState((current) => ({
          sourceRevision,
          result: { ...current.result, format: "jsonl", stats: message.stats! },
          agentSession: message.agentSession ?? null,
          progress: message.progress,
        }));
      }
    };

    currentWorker.addEventListener("message", onMessage);
    return () => {
      window.clearTimeout(timeoutId);
      if (chunkTimeoutId !== null) {
        window.clearTimeout(chunkTimeoutId);
      }
      publisher.cancel();
      currentWorker.removeEventListener("message", onMessage);
    };
  }, [forcedFormat, input, sourceFile, sourceRevision]);

  // Terminate the worker thread when the hook's owner unmounts; the per-request
  // cleanup above only detaches listeners and timers.
  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );

  return belongsToSourceRevision(sourceRevision, parserState)
    ? parserState
    : pendingSnapshot(sourceRevision, forcedFormat, sourceFile);
};
