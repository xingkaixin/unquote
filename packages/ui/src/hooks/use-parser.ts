import type { JsonlRecord, ParseResult } from "@unquote/core";
import { useEffect, useRef, useState } from "react";
import { parseInput, parseJson } from "@unquote/core";
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

const getJsonlCandidateLines = (input: string) => {
  const lines: string[] = [];
  let start = 0;

  for (let index = 0; index <= input.length && lines.length < 8; index += 1) {
    if (index < input.length && input.charCodeAt(index) !== 10) {
      continue;
    }

    const end = index > start && input.charCodeAt(index - 1) === 13 ? index - 1 : index;
    const line = input.slice(start, end).trim();
    if (line) {
      lines.push(line);
    }
    start = index + 1;
  }

  return lines;
};

const shouldStreamJsonl = (input: string, forcedFormat?: "json" | "jsonl") => {
  if (forcedFormat === "jsonl") {
    return true;
  }
  if (forcedFormat === "json") {
    return false;
  }

  const lines = getJsonlCandidateLines(input);
  if (lines.length < 2) {
    return false;
  }

  return lines.every((line) => {
    try {
      parseJson(line);
      return true;
    } catch {
      return false;
    }
  });
};

export const useParser = (
  input: string,
  forcedFormat?: "json" | "jsonl",
  sourceFile?: File | null,
) => {
  const [parserState, setParserState] = useState(() => ({
    result: parseInput(input, withForcedFormat(forcedFormat)),
    recordsVersion: 0,
  }));
  const [progress, setProgress] = useState<ParserProgress>(idleProgress);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    if (typeof Worker === "undefined") {
      if (sourceFile) {
        void sourceFile.text().then((text) => {
          if (requestIdRef.current !== requestId) {
            return;
          }
          const parsed = parseInput(text, { forcedFormat: "jsonl" });
          setParserState((current) => ({
            result: parsed,
            recordsVersion: current.recordsVersion + 1,
          }));
          setProgress({
            processedLines: parsed.stats.total,
            success: parsed.stats.success,
            failed: parsed.stats.failed,
            elapsedMs: 0,
            done: true,
          });
        });
        return;
      }

      const parsed = parseInput(input, withForcedFormat(forcedFormat));
      setParserState((current) => ({
        result: parsed,
        recordsVersion: current.recordsVersion + 1,
      }));
      setProgress({
        processedLines: parsed.stats.total,
        success: parsed.stats.success,
        failed: parsed.stats.failed,
        elapsedMs: 0,
        done: true,
      });
      return;
    }

    workerRef.current ??= new Worker(new URL("../worker/parser-worker.ts", import.meta.url), {
      type: "module",
    });

    const currentWorker = workerRef.current;
    setParserState((current) => ({
      result: sourceFile ? emptyResult("jsonl") : emptyResult(forcedFormat),
      recordsVersion: current.recordsVersion + 1,
    }));
    setProgress({ ...idleProgress, done: false });
    let chunkTimeoutId: number | null = null;
    const streamedRecords: JsonlRecord[] = [];
    let pendingStreamSnapshot: {
      stats: ParseResult["stats"];
      progress: ParserProgress;
    } | null = null;
    let streamFlushFrameId: number | null = null;
    let hasPublishedStream = false;

    const cancelStreamFlush = () => {
      if (streamFlushFrameId === null) {
        return;
      }

      window.cancelAnimationFrame(streamFlushFrameId);
      streamFlushFrameId = null;
    };

    const publishStream = () => {
      streamFlushFrameId = null;
      if (!pendingStreamSnapshot) {
        return;
      }

      const snapshot = pendingStreamSnapshot;
      pendingStreamSnapshot = null;
      hasPublishedStream = true;
      setProgress(snapshot.progress);
      setParserState((current) => ({
        result: {
          format: "jsonl",
          records: streamedRecords,
          stats: snapshot.stats,
        },
        recordsVersion: current.recordsVersion + 1,
      }));
    };

    const scheduleStreamPublish = () => {
      if (!hasPublishedStream || pendingStreamSnapshot?.progress.done) {
        cancelStreamFlush();
        publishStream();
        return;
      }

      streamFlushFrameId ??= window.requestAnimationFrame(publishStream);
    };

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
        streamedRecords.push(...message.records);
        pendingStreamSnapshot = {
          stats: message.stats,
          progress: message.progress,
        };
        scheduleStreamPublish();
        return;
      }

      cancelStreamFlush();
      publishStream();
      setProgress(message.progress);
      if (message.result) {
        setParserState((current) => ({
          result: message.result!,
          recordsVersion: current.recordsVersion + 1,
        }));
        return;
      }
      if (message.stats) {
        setParserState((current) => ({
          result: { ...current.result, format: "jsonl", stats: message.stats! },
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
      cancelStreamFlush();
      currentWorker.removeEventListener("message", onMessage);
    };
  }, [forcedFormat, input, sourceFile]);

  return { result: parserState.result, progress, recordsVersion: parserState.recordsVersion };
};
