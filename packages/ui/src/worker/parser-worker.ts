import type { JsonlRecord, ParseResult } from "@unquote/core";
import type { AgentSession } from "../lib/agent-session";
import { serializeDiagnosticError } from "../lib/diagnostics";
import type { DiagnosticError } from "../lib/diagnostics";
import { createJsonlIngestion } from "../lib/jsonl-ingestion";
import { drainJsonlLines } from "../lib/jsonl-lines";
import { parseText, type ParserProgress } from "../lib/parse-text";

export type ParserRequest =
  | {
      type: "parse";
      requestId: number;
      input: string;
      forcedFormat?: "json" | "jsonl";
    }
  | {
      type: "start-jsonl";
      requestId: number;
    }
  | {
      type: "jsonl-chunk";
      requestId: number;
      chunk: string;
      done: boolean;
    }
  | {
      type: "file-jsonl";
      requestId: number;
      file: File;
    };

export type ParserWorkerResponse =
  | {
      type: "agent-session-detected";
      requestId: number;
    }
  | {
      type: "batch";
      requestId: number;
      records: JsonlRecord[];
      stats: ParseResult["stats"];
      progress: ParserProgress;
    }
  | {
      type: "complete-result";
      requestId: number;
      result: ParseResult;
      agentSession: AgentSession | null;
      progress: ParserProgress;
    }
  | {
      type: "complete-stats";
      requestId: number;
      stats: ParseResult["stats"];
      agentSession: AgentSession | null;
      progress: ParserProgress;
    }
  | {
      type: "error";
      requestId: number;
      stats: ParseResult["stats"];
      progress: ParserProgress;
      error: DiagnosticError;
    };

const batchSize = 64;
let latestRequestId = 0;

const elapsed = (startedAt: number) => Number((performance.now() - startedAt).toFixed(2));

interface JsonlSession {
  startedAt: number;
  buffer: string;
  lineNumber: number;
  batch: JsonlRecord[];
  compactForTransfer: boolean;
  ingestion: ReturnType<typeof createJsonlIngestion>;
}

let jsonlSession: JsonlSession | null = null;

const postAgentSessionDetected = (requestId: number) => {
  self.postMessage({
    type: "agent-session-detected",
    requestId,
  } satisfies ParserWorkerResponse);
};

const createJsonlSession = (
  requestId: number,
  compactForTransfer = false,
  fileName?: string,
): JsonlSession => ({
  startedAt: performance.now(),
  buffer: "",
  lineNumber: 1,
  batch: [],
  compactForTransfer,
  ingestion: createJsonlIngestion(fileName, () => postAgentSessionDetected(requestId)),
});

const statsFromSession = (session: JsonlSession) => session.ingestion.stats();

const progressFromSession = (session: JsonlSession, done: boolean): ParserProgress => {
  return {
    elapsedMs: elapsed(session.startedAt),
    done,
  };
};

const postSessionComplete = (requestId: number, session: JsonlSession) => {
  self.postMessage({
    type: "complete-stats",
    requestId,
    stats: statsFromSession(session),
    agentSession: session.ingestion.finishAgentSession(),
    progress: progressFromSession(session, true),
  } satisfies ParserWorkerResponse);
};

const postRequestError = (requestId: number, session: JsonlSession | null, error: unknown) => {
  self.postMessage({
    type: "error",
    requestId,
    stats: session ? statsFromSession(session) : { total: 0, success: 0, failed: 0 },
    progress: session ? progressFromSession(session, true) : { elapsedMs: 0, done: true },
    error: serializeDiagnosticError(error),
  } satisfies ParserWorkerResponse);
};

const postBatch = (requestId: number, session: JsonlSession, done: boolean) => {
  if (session.batch.length === 0) {
    return;
  }

  const records = session.batch.splice(0, session.batch.length);
  self.postMessage({
    type: "batch",
    requestId,
    records,
    stats: statsFromSession(session),
    progress: progressFromSession(session, done),
  } satisfies ParserWorkerResponse);
};

const parseJsonlLine = (requestId: number, session: JsonlSession, line: string) => {
  if (!line.trim()) {
    session.lineNumber += 1;
    return;
  }

  const record = session.compactForTransfer
    ? session.ingestion.ingestPreviewLine(line, session.lineNumber)
    : session.ingestion.ingestFullLine(line, session.lineNumber);
  session.lineNumber += 1;
  session.batch.push(record);

  if (session.ingestion.processedLines === 1 || session.batch.length >= batchSize) {
    postBatch(requestId, session, false);
  }
};

const processJsonlChunk = (
  requestId: number,
  session: JsonlSession,
  chunk: string,
  done: boolean,
) => {
  const drained = drainJsonlLines(session.buffer, chunk, done, (line) => {
    parseJsonlLine(requestId, session, line);
  });
  session.buffer = drained.buffer;

  postBatch(requestId, session, done);
};

const parseJson = ({
  requestId,
  input,
  forcedFormat,
}: Extract<ParserRequest, { type: "parse" }>) => {
  const { result, agentSession, progress } = parseText(input, {
    forcedFormat,
    onAgentSessionDetected: () => postAgentSessionDetected(requestId),
  });
  self.postMessage({
    type: "complete-result",
    requestId,
    result,
    agentSession,
    progress,
  } satisfies ParserWorkerResponse);
};

const parseJsonlFile = async (requestId: number, file: File, session: JsonlSession) => {
  let reader: ReadableStreamDefaultReader<string> | null = null;
  let failure: { error: unknown } | null = null;

  try {
    reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();

    while (true) {
      if (requestId !== latestRequestId) {
        return;
      }

      const { value, done } = await reader.read();
      if (requestId !== latestRequestId) {
        return;
      }

      processJsonlChunk(requestId, session, value ?? "", done);
      if (done) {
        postSessionComplete(requestId, session);
        return;
      }
    }
  } catch (error) {
    failure = { error };
  } finally {
    if (jsonlSession === session) {
      jsonlSession = null;
    }
    await reader?.cancel().catch(() => undefined);
  }

  if (failure && requestId === latestRequestId) {
    postRequestError(requestId, session, failure.error);
  }
};

const handleRequest = (message: ParserRequest) => {
  if (message.type === "parse") {
    latestRequestId = message.requestId;
    parseJson(message);
    return;
  }

  if (message.type === "start-jsonl") {
    latestRequestId = message.requestId;
    jsonlSession = createJsonlSession(message.requestId);
    return;
  }

  if (message.type === "file-jsonl") {
    latestRequestId = message.requestId;
    jsonlSession = createJsonlSession(message.requestId, true, message.file.name);
    void parseJsonlFile(message.requestId, message.file, jsonlSession);
    return;
  }

  if (message.requestId !== latestRequestId || !jsonlSession) {
    return;
  }

  processJsonlChunk(message.requestId, jsonlSession, message.chunk, message.done);

  if (message.done) {
    postSessionComplete(message.requestId, jsonlSession);
    jsonlSession = null;
  }
};

self.onmessage = (event: MessageEvent<ParserRequest>) => {
  try {
    handleRequest(event.data);
  } catch (error) {
    // Without this the failure surfaces as an uncaught worker exception and
    // the request never reaches a terminal state on the main thread.
    const session = jsonlSession;
    jsonlSession = null;
    postRequestError(event.data.requestId, session, error);
  }
};
