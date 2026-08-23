import { parseInput } from "@unquote/core";
import type { ParseResult } from "@unquote/core";
import { useEffect, useEffectEvent, useState } from "react";
import { probeJsonl } from "@unquote/core";
import { toast } from "sonner";
import { useTranslation } from "../i18n/context";
import { mightContainAgentSession } from "../lib/agent-session/probe";
import type { ParsedText, ParserProgress } from "../lib/parse-text";
import { markPerf, measurePerf } from "../lib/perf";
import { resolveSourceWork } from "../lib/published-source";
import type { PublishedSourceRevision } from "../lib/published-source";
import { belongsToSourceRevision, commitSourceRevisionResult } from "../lib/source-revision";
import type { SourceRevision } from "../lib/source-revision";
import type { RecordAppend } from "../lib/record-sequence";
import { isWithinMainThreadBudget } from "../lib/main-thread-budget";
import { createStreamPublisher } from "../lib/stream-publisher";
import { createWorkerRequestRunner } from "../lib/worker-lifecycle";
import type { WorkerRun } from "../lib/worker-lifecycle";
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

const parseInitialText = (
  input: string,
  forcedFormat: "json" | "jsonl" | undefined,
): ParsedText => {
  const startedAt = performance.now();
  const result = parseInput(input, forcedFormat ? { forcedFormat } : {});
  return {
    result,
    agentSession: null,
    progress: {
      processedLines: result.stats.total,
      success: result.stats.success,
      failed: result.stats.failed,
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

type ParserStateUpdate = ParserSnapshot | ((current: ParserSnapshot) => ParserSnapshot);

const pendingSnapshot = (
  sourceRevision: SourceRevision,
  forcedFormat: "json" | "jsonl" | undefined,
  hasLocalFile: boolean,
): ParserSnapshot => ({
  sourceRevision,
  result: hasLocalFile ? emptyResult("jsonl") : emptyResult(forcedFormat),
  progress: { ...idleProgress, done: false },
  agentSession: null,
  recordAppend: null,
});

const parseFileOnMainThread = async (
  file: File,
  onAgentSessionDetected: () => void,
): Promise<ParsedText> => {
  const text = await file.text();
  const { parseText } = await import("../lib/parse-text");
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
  const { parseText } = await import("../lib/parse-text");
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

export interface UseParserOptions {
  source: PublishedSourceRevision;
  onAgentSessionDetected?: (() => void) | undefined;
}

export const useParser = ({ source, onAgentSessionDetected }: UseParserOptions) => {
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
      parsed: parseInitialText(input, forcedFormat),
    };
  });
  const [parserState, setParserState] = useState<ParserSnapshot>(() =>
    mountParse
      ? { sourceRevision, ...mountParse.parsed, recordAppend: null }
      : pendingSnapshot(sourceRevision, forcedFormat, sourceAccess !== null),
  );
  const commitParserState = useEffectEvent((update: ParserStateUpdate) => {
    setParserState((current) =>
      commitSourceRevisionResult(current, typeof update === "function" ? update(current) : update),
    );
  });
  const [workerRunner] = useState(() =>
    createWorkerRequestRunner(
      () => new Worker(new URL("../worker/parser-worker.ts", import.meta.url), { type: "module" }),
    ),
  );
  const sourceFile = sourceAccess?.getFile() ?? null;
  const reportFileReadError = useEffectEvent(() => {
    toast.error(t("input.readFailed"));
  });
  const reportInputTooLarge = useEffectEvent(() => {
    toast.error(t("input.tooLargeWithoutWorker"));
  });
  const reportAgentSessionDetected = useEffectEvent(() => {
    onAgentSessionDetected?.();
  });

  useEffect(() => {
    const reusingMountParse =
      mountParse?.sourceRevision === sourceRevision &&
      mountParse.input === input &&
      mountParse.forcedFormat === forcedFormat &&
      !sourceAccess;
    if (
      reusingMountParse &&
      (mountParse.parsed.result.format !== "jsonl" || !mightContainAgentSession(input))
    ) {
      return;
    }
    const applyParsedText = ({ result, agentSession, progress }: ParsedText) => {
      commitParserState({
        sourceRevision,
        result,
        agentSession,
        progress,
        recordAppend: null,
      });
    };
    const applyAgentEnrichment = ({
      agentSession,
      progress,
    }: Pick<ParsedText, "agentSession" | "progress">) => {
      commitParserState((current) => ({
        ...current,
        sourceRevision,
        agentSession,
        progress,
      }));
    };

    const reportUnparsedSource = () => {
      commitParserState({
        ...pendingSnapshot(sourceRevision, forcedFormat, sourceAccess !== null),
        progress: idleProgress,
      });
      reportFileReadError();
    };

    const reportUnparsedSourceTooLarge = () => {
      commitParserState({
        ...pendingSnapshot(sourceRevision, forcedFormat, sourceAccess !== null),
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
    const parseOnMainThread = (run: WorkerRun) => {
      if (sourceFile) {
        if (!isWithinMainThreadBudget(sourceFile.size)) {
          run.finish();
          reportUnparsedSourceTooLarge();
          return;
        }

        void parseFileOnMainThread(sourceFile, reportAgentSessionDetected)
          .then((parsed) => {
            if (run.finish()) {
              applyParsedText(parsed);
            }
          })
          .catch(() => {
            if (run.finish()) {
              reportUnparsedSource();
            }
          });
        return;
      }

      if (!isWithinMainThreadBudget(input.length)) {
        run.finish();
        reportUnparsedSourceTooLarge();
        return;
      }

      if (!shouldStreamJsonl(input, forcedFormat)) {
        run.finish();
        applyParsedText(parseInitialText(input, forcedFormat));
        return;
      }

      void parseTextOnMainThread(input, forcedFormat, reportAgentSessionDetected)
        .then((parsed) => {
          if (run.finish()) {
            if (reusingMountParse) {
              applyAgentEnrichment(parsed);
            } else {
              applyParsedText(parsed);
            }
          }
        })
        .catch(() => {
          if (run.finish()) {
            reportUnparsedSource();
          }
        });
    };
    let chunkTimeoutId: number | null = null;

    const publisher = createStreamPublisher<ParseResult["stats"], ParserProgress>(
      (records, stats, progress, recordAppend) => {
        commitParserState((current) => ({
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
      if (reusingMountParse) {
        return;
      }
      reportUnparsedSource();
    };

    let workerRun: WorkerRun;

    const post = (message: ParserRequest) => {
      return workerRun.post(message);
    };

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
        const posted = post({
          type: "jsonl-chunk",
          requestId: workerRun.requestId,
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

    const onMessage = (event: MessageEvent<ParserWorkerResponse>) => {
      const message = event.data;
      if (message.requestId !== workerRun.requestId) {
        return;
      }

      if (message.type === "agent-session-detected") {
        reportAgentSessionDetected();
        return;
      }

      if (message.type === "batch") {
        if (reusingMountParse) {
          return;
        }
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
        if (reusingMountParse) {
          return;
        }
        markPerf("parse:error");
        measurePerf("parse:error", "parse:start", "parse:error");
        commitParserState((current) => ({
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
        if (reusingMountParse) {
          applyAgentEnrichment(message);
        } else {
          commitParserState({
            sourceRevision,
            result: message.result,
            agentSession: message.agentSession,
            progress: message.progress,
            recordAppend: null,
          });
        }
        return;
      }

      if (reusingMountParse) {
        applyAgentEnrichment(message);
        return;
      }

      commitParserState((current) => ({
        sourceRevision,
        result: { ...current.result, format: "jsonl", stats: message.stats },
        agentSession: message.agentSession,
        progress: message.progress,
        recordAppend: current.recordAppend,
      }));
    };

    workerRun = workerRunner.begin({
      onMessage,
      onFailure: handleWorkerFailure,
    });

    if (!workerRun.available) {
      publisher.cancel();
      parseOnMainThread(workerRun);
      return () => void workerRun.cancel();
    }

    if (!reusingMountParse) {
      commitParserState(pendingSnapshot(sourceRevision, forcedFormat, sourceAccess !== null));
    }
    markPerf("parse:start");

    const timeoutId = window.setTimeout(
      () => {
        if (sourceFile) {
          post({ type: "file-jsonl", requestId: workerRun.requestId, file: sourceFile });
          return;
        }

        if (shouldStreamJsonl(input, forcedFormat)) {
          postJsonlChunks();
          return;
        }

        post(
          forcedFormat
            ? { type: "parse", requestId: workerRun.requestId, input, forcedFormat }
            : { type: "parse", requestId: workerRun.requestId, input },
        );
      },
      reusingMountParse ? 0 : 120,
    );

    return () => {
      window.clearTimeout(timeoutId);
      if (chunkTimeoutId !== null) {
        window.clearTimeout(chunkTimeoutId);
      }
      publisher.cancel();
      workerRun.cancel();
    };
  }, [forcedFormat, input, mountParse, sourceAccess, sourceRevision, workerRunner]);

  // Terminate an idle worker when the hook's owner unmounts; active work is
  // terminated by the request cleanup above.
  useEffect(
    () => () => {
      workerRunner.dispose();
    },
    [workerRunner],
  );

  return belongsToSourceRevision(sourceRevision, parserState)
    ? parserState
    : pendingSnapshot(sourceRevision, forcedFormat, sourceAccess !== null);
};
