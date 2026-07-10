import type { ParseResult } from "@unquote/core";
import { useEffect, useRef, useState } from "react";
import { parseInput, probeJsonl } from "@unquote/core";
import { createAgentSessionFromText } from "../lib/agent-session";
import type { AgentSession } from "../lib/agent-session";
import { markPerf, measurePerf } from "../lib/perf";
import { createStreamPublisher } from "../lib/stream-publisher";
import type { ParserProgress, ParserRequest, ParserWorkerResponse } from "../worker/parser-worker";

const withForcedFormat = (forcedFormat?: "json" | "jsonl") =>
  forcedFormat ? { forcedFormat } : {};

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

interface MainThreadParse {
  result: ParseResult;
  agentSession: AgentSession | null;
  progress: ParserProgress;
}

const completedProgress = (stats: ParseResult["stats"]): ParserProgress => ({
  processedLines: stats.total,
  success: stats.success,
  failed: stats.failed,
  elapsedMs: 0,
  done: true,
});

// No-Worker fallback paths; both produce the same shape so the effect has a
// single apply point.
const parseTextOnMainThread = (input: string, forcedFormat?: "json" | "jsonl"): MainThreadParse => {
  const result = parseInput(input, withForcedFormat(forcedFormat));
  return {
    result,
    agentSession: result.format === "jsonl" ? createAgentSessionFromText(input) : null,
    progress: completedProgress(result.stats),
  };
};

const parseFileOnMainThread = async (file: File): Promise<MainThreadParse> => {
  const text = await file.text();
  const result = parseInput(text, { forcedFormat: "jsonl" });
  return {
    result,
    agentSession: createAgentSessionFromText(text, file.name),
    progress: completedProgress(result.stats),
  };
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

export const useParser = (
  input: string,
  forcedFormat?: "json" | "jsonl",
  sourceFile?: File | null,
  onFileReadError?: () => void,
) => {
  const [parserState, setParserState] = useState(() => ({
    result: parseInput(input, withForcedFormat(forcedFormat)),
    agentSession: forcedFormat === "json" ? null : createAgentSessionFromText(input),
    recordsVersion: 0,
  }));
  const [progress, setProgress] = useState<ParserProgress>(idleProgress);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const onFileReadErrorRef = useRef(onFileReadError);
  onFileReadErrorRef.current = onFileReadError;

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    if (typeof Worker === "undefined") {
      const applyMainThreadParse = ({ result, agentSession, progress }: MainThreadParse) => {
        setParserState((current) => ({
          result,
          agentSession,
          recordsVersion: current.recordsVersion + 1,
        }));
        setProgress(progress);
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
              setProgress(idleProgress);
              onFileReadErrorRef.current?.();
            }
          });
        return;
      }

      applyMainThreadParse(parseTextOnMainThread(input, forcedFormat));
      return;
    }

    workerRef.current ??= new Worker(new URL("../worker/parser-worker.ts", import.meta.url), {
      type: "module",
    });

    const currentWorker = workerRef.current;
    setParserState((current) => ({
      result: sourceFile ? emptyResult("jsonl") : emptyResult(forcedFormat),
      agentSession: null,
      recordsVersion: current.recordsVersion + 1,
    }));
    setProgress({ ...idleProgress, done: false });
    markPerf("parse:start");
    let chunkTimeoutId: number | null = null;

    const publisher = createStreamPublisher<ParseResult["stats"], ParserProgress>(
      (records, stats, progress) => {
        setProgress(progress);
        setParserState((current) => ({
          result: { format: "jsonl", records, stats },
          agentSession: current.agentSession,
          recordsVersion: current.recordsVersion + 1,
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
        setProgress(message.progress);
        setParserState((current) => ({
          result: { ...current.result, format: "jsonl", stats: message.stats },
          agentSession: null,
          recordsVersion: current.recordsVersion + 1,
        }));
        onFileReadErrorRef.current?.();
        return;
      }

      markPerf("parse:complete");
      measurePerf("parse:complete", "parse:start", "parse:complete");
      setProgress(message.progress);
      if (message.result) {
        setParserState((current) => ({
          result: message.result!,
          agentSession: message.agentSession ?? null,
          recordsVersion: current.recordsVersion + 1,
        }));
        return;
      }
      if (message.stats) {
        setParserState((current) => ({
          result: { ...current.result, format: "jsonl", stats: message.stats! },
          agentSession: message.agentSession ?? null,
          recordsVersion: current.recordsVersion + 1,
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
  }, [forcedFormat, input, sourceFile]);

  // Terminate the worker thread when the hook's owner unmounts; the per-request
  // cleanup above only detaches listeners and timers.
  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );

  return {
    result: parserState.result,
    progress,
    recordsVersion: parserState.recordsVersion,
    agentSession: parserState.agentSession,
  };
};
