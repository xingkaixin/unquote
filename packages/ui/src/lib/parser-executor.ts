import { parseInput, probeJsonl } from "@unquote/core";
import type { ParseResult } from "@unquote/core";
import type { ParsedText, ParserProgress } from "./parse-text";
import { reportDiagnostic } from "./diagnostics";
import { markPerf, measurePerf } from "./perf";
import { belongsToSourceRevision } from "./source-revision";
import type { SourceRevision } from "./source-revision";
import type { RecordAppend } from "./record-sequence";
import { isWithinMainThreadBudget } from "./main-thread-budget";
import { createStreamPublisher } from "./stream-publisher";
import { createWorkerRequestRunner } from "./worker-lifecycle";
import type { WorkerRun } from "./worker-lifecycle";
import type { ParserRequest, ParserWorkerResponse } from "../worker/parser-worker";

const workerChunkSize = 256 * 1024;

const emptyResult = (forcedFormat?: "json" | "jsonl"): ParseResult => ({
  format: forcedFormat ?? "json",
  records: [],
  stats: { total: 0, success: 0, failed: 0 },
});

export const idleParserProgress: ParserProgress = {
  elapsedMs: 0,
  done: true,
};

export const parseInitialText = (
  input: string,
  forcedFormat: "json" | "jsonl" | undefined,
): ParsedText => {
  const startedAt = performance.now();
  const result = parseInput(input, forcedFormat ? { forcedFormat } : {});
  return {
    result,
    agentSession: null,
    progress: {
      elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
      done: true,
    },
  };
};

export interface ParserSnapshot {
  sourceRevision: SourceRevision;
  result: ParseResult;
  progress: ParserProgress;
  agentSession: ParsedText["agentSession"];
  recordAppend: RecordAppend | null;
}

export type ParserStateUpdate = ParserSnapshot | ((current: ParserSnapshot) => ParserSnapshot);

export const pendingParserSnapshot = (
  sourceRevision: SourceRevision,
  forcedFormat: "json" | "jsonl" | undefined,
  hasLocalFile: boolean,
): ParserSnapshot => ({
  sourceRevision,
  result: hasLocalFile ? emptyResult("jsonl") : emptyResult(forcedFormat),
  progress: { ...idleParserProgress, done: false },
  agentSession: null,
  recordAppend: null,
});

const parseFileOnMainThread = async (
  file: File,
  onAgentSessionDetected: () => void,
): Promise<ParsedText> => {
  const text = await file.text();
  const { parseText } = await import("./parse-text");
  return parseText(text, {
    forcedFormat: "jsonl",
    fileName: file.name,
    onAgentSessionDetected,
  });
};

const parseTextOnMainThread = async (
  input: string,
  forcedFormat: "json" | "jsonl" | undefined,
  onAgentSessionDetected: () => void,
) => {
  const { parseText } = await import("./parse-text");
  return parseText(input, { forcedFormat, onAgentSessionDetected });
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

export interface ParserExecution {
  sourceRevision: SourceRevision;
  input: string;
  forcedFormat: "json" | "jsonl" | undefined;
  sourceFile: File | null;
  commit: (update: ParserStateUpdate) => void;
  onReadError: () => void;
  onTooLarge: () => void;
  onAgentSessionDetected: () => void;
}

export interface ParserExecutor {
  run: (execution: ParserExecution) => () => void;
  dispose: () => void;
}

export const createParserExecutor = (): ParserExecutor => {
  const workerRunner = createWorkerRequestRunner(
    () => new Worker(new URL("../worker/parser-worker.ts", import.meta.url), { type: "module" }),
  );

  return {
    run({
      sourceRevision,
      input,
      forcedFormat,
      sourceFile,
      commit,
      onReadError,
      onTooLarge,
      onAgentSessionDetected,
    }) {
      const applyParsedText = ({ result, agentSession, progress }: ParsedText) => {
        commit({ sourceRevision, result, agentSession, progress, recordAppend: null });
      };
      const reportUnparsedSource = (report: () => void) => {
        commit({
          ...pendingParserSnapshot(sourceRevision, forcedFormat, sourceFile !== null),
          progress: idleParserProgress,
        });
        report();
      };
      const parseOnMainThread = (run: WorkerRun) => {
        if (sourceFile) {
          if (!isWithinMainThreadBudget(sourceFile.size)) {
            run.finish();
            reportUnparsedSource(onTooLarge);
            return;
          }
          void parseFileOnMainThread(sourceFile, onAgentSessionDetected)
            .then((parsed) => {
              if (run.finish()) {
                applyParsedText(parsed);
              }
            })
            .catch((error: unknown) => {
              if (run.finish()) {
                reportDiagnostic("parser.main-thread-file", error);
                reportUnparsedSource(onReadError);
              }
            });
          return;
        }

        if (!isWithinMainThreadBudget(input.length)) {
          run.finish();
          reportUnparsedSource(onTooLarge);
          return;
        }
        if (!shouldStreamJsonl(input, forcedFormat)) {
          run.finish();
          applyParsedText(parseInitialText(input, forcedFormat));
          return;
        }

        void parseTextOnMainThread(input, forcedFormat, onAgentSessionDetected)
          .then((parsed) => {
            if (run.finish()) {
              applyParsedText(parsed);
            }
          })
          .catch((error: unknown) => {
            if (run.finish()) {
              reportDiagnostic("parser.main-thread-text", error);
              reportUnparsedSource(onReadError);
            }
          });
      };

      let chunkTimeoutId: number | null = null;
      const publisher = createStreamPublisher<ParseResult["stats"], ParserProgress>(
        (records, stats, progress, recordAppend) => {
          commit((current) => ({
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

      const handleWorkerFailure = () => {
        if (chunkTimeoutId !== null) {
          window.clearTimeout(chunkTimeoutId);
        }
        publisher.cancel();
        reportUnparsedSource(onReadError);
      };

      let workerRun: WorkerRun;
      const post = (message: ParserRequest) => workerRun.post(message);
      const postJsonlChunks = () => {
        if (!post({ type: "start-jsonl", requestId: workerRun.requestId })) {
          return;
        }
        let offset = 0;
        const postNextChunk = () => {
          if (!workerRun.isActive()) {
            return;
          }
          const end = Math.min(input.length, offset + workerChunkSize);
          if (
            !post({
              type: "jsonl-chunk",
              requestId: workerRun.requestId,
              chunk: input.slice(offset, end),
              done: end >= input.length,
            })
          ) {
            return;
          }
          offset = end;
          if (offset < input.length) {
            chunkTimeoutId = window.setTimeout(postNextChunk, 0);
          }
        };
        postNextChunk();
      };

      const onMessage = (event: MessageEvent<ParserWorkerResponse>) => {
        const message = event.data;
        if (message.requestId !== workerRun.requestId) {
          return;
        }
        if (message.type === "agent-session-detected") {
          onAgentSessionDetected();
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
        if (!workerRun.finish()) {
          return;
        }

        publisher.flush();
        if (message.type === "error") {
          reportDiagnostic("parser.worker", message.error);
          markPerf("parse:error");
          measurePerf("parse:error", "parse:start", "parse:error");
          commit((current) => ({
            sourceRevision,
            result: { ...current.result, format: "jsonl", stats: message.stats },
            agentSession: null,
            progress: message.progress,
            recordAppend: current.recordAppend,
          }));
          onReadError();
          return;
        }

        markPerf("parse:complete");
        measurePerf("parse:complete", "parse:start", "parse:complete");
        if (message.type === "complete-result") {
          applyParsedText(message);
          return;
        }
        commit((current) => ({
          sourceRevision,
          result: { ...current.result, format: "jsonl", stats: message.stats },
          agentSession: message.agentSession,
          progress: message.progress,
          recordAppend: current.recordAppend,
        }));
      };

      workerRun = workerRunner.begin({ onMessage, onFailure: handleWorkerFailure });
      if (!workerRun.available) {
        publisher.cancel();
        parseOnMainThread(workerRun);
        return () => void workerRun.cancel();
      }

      commit(pendingParserSnapshot(sourceRevision, forcedFormat, sourceFile !== null));
      markPerf("parse:start");
      const timeoutId = window.setTimeout(() => {
        if (sourceFile) {
          post({ type: "file-jsonl", requestId: workerRun.requestId, file: sourceFile });
        } else if (shouldStreamJsonl(input, forcedFormat)) {
          postJsonlChunks();
        } else {
          post(
            forcedFormat
              ? { type: "parse", requestId: workerRun.requestId, input, forcedFormat }
              : { type: "parse", requestId: workerRun.requestId, input },
          );
        }
      }, 120);

      return () => {
        window.clearTimeout(timeoutId);
        if (chunkTimeoutId !== null) {
          window.clearTimeout(chunkTimeoutId);
        }
        publisher.cancel();
        workerRun.cancel();
      };
    },
    dispose() {
      workerRunner.dispose();
    },
  };
};
