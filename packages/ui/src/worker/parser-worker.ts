import type { JsonlRecord, ParseResult } from "@unquote/core";
import { createSseRecordReader } from "@unquote/core/ingestion";
import type { AgentSession } from "../lib/agent-session";
import { serializeDiagnosticError } from "../lib/diagnostics";
import type { DiagnosticError } from "../lib/diagnostics";
import { createJsonlIngestion } from "../lib/jsonl-ingestion";
import { drainJsonlLines } from "../lib/jsonl-lines";
import { parseText, type ParserProgress } from "../lib/parse-text";

export type StreamFormat = "jsonl" | "sse";

export type ParserRequest =
  | {
      type: "parse";
      requestId: number;
      input: string;
      forcedFormat?: ParseResult["format"];
    }
  | {
      type: "start-stream";
      requestId: number;
      format: StreamFormat;
    }
  | {
      type: "stream-chunk";
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

interface RecordStream {
  pushLine: (line: string, lineNumber: number) => JsonlRecord | null;
  finish: () => JsonlRecord | null;
  stats: () => ParseResult["stats"];
  finishAgentSession: () => AgentSession | null;
}

interface StreamSession {
  startedAt: number;
  buffer: string;
  lineNumber: number;
  recordCount: number;
  batch: JsonlRecord[];
  records: RecordStream;
}

let streamSession: StreamSession | null = null;

const postAgentSessionDetected = (requestId: number) => {
  self.postMessage({
    type: "agent-session-detected",
    requestId,
  } satisfies ParserWorkerResponse);
};

const createJsonlRecordStream = (
  requestId: number,
  compactForTransfer: boolean,
  fileName?: string,
): RecordStream => {
  const ingestion = createJsonlIngestion(fileName, () => postAgentSessionDetected(requestId));
  return {
    pushLine: (line, lineNumber) => {
      if (!line.trim()) {
        return null;
      }
      return compactForTransfer
        ? ingestion.ingestPreviewLine(line, lineNumber)
        : ingestion.ingestFullLine(line, lineNumber);
    },
    finish: () => null,
    stats: ingestion.stats,
    finishAgentSession: ingestion.finishAgentSession,
  };
};

const createSseRecordStream = (): RecordStream => {
  const reader = createSseRecordReader();
  let total = 0;
  const count = (record: JsonlRecord | null) => {
    if (record) {
      total += 1;
    }
    return record;
  };
  return {
    pushLine: (line, lineNumber) => count(reader.pushLine(line, lineNumber)),
    finish: () => count(reader.finish()),
    stats: () => ({ total, success: total, failed: 0 }),
    finishAgentSession: () => null,
  };
};

const createStreamSession = (records: RecordStream): StreamSession => ({
  startedAt: performance.now(),
  buffer: "",
  lineNumber: 1,
  recordCount: 0,
  batch: [],
  records,
});

const statsFromSession = (session: StreamSession) => session.records.stats();

const progressFromSession = (session: StreamSession, done: boolean): ParserProgress => {
  return {
    elapsedMs: elapsed(session.startedAt),
    done,
  };
};

const postSessionComplete = (requestId: number, session: StreamSession) => {
  self.postMessage({
    type: "complete-stats",
    requestId,
    stats: statsFromSession(session),
    agentSession: session.records.finishAgentSession(),
    progress: progressFromSession(session, true),
  } satisfies ParserWorkerResponse);
};

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Thrown values and promise rejections are not restricted to Error instances.
const postRequestError = (requestId: number, session: StreamSession | null, error: unknown) => {
  self.postMessage({
    type: "error",
    requestId,
    stats: session ? statsFromSession(session) : { total: 0, success: 0, failed: 0 },
    progress: session ? progressFromSession(session, true) : { elapsedMs: 0, done: true },
    error: serializeDiagnosticError(error),
  } satisfies ParserWorkerResponse);
};

const postBatch = (requestId: number, session: StreamSession, done: boolean) => {
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

const pushRecord = (requestId: number, session: StreamSession, record: JsonlRecord | null) => {
  if (!record) {
    return;
  }

  session.recordCount += 1;
  session.batch.push(record);
  if (session.recordCount === 1 || session.batch.length >= batchSize) {
    postBatch(requestId, session, false);
  }
};

const processStreamChunk = (
  requestId: number,
  session: StreamSession,
  chunk: string,
  done: boolean,
) => {
  const drained = drainJsonlLines(session.buffer, chunk, done, (line) => {
    const record = session.records.pushLine(line, session.lineNumber);
    session.lineNumber += 1;
    pushRecord(requestId, session, record);
  });
  session.buffer = drained.buffer;
  if (done) {
    pushRecord(requestId, session, session.records.finish());
  }

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

const parseJsonlFile = async (requestId: number, file: File, session: StreamSession) => {
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

      processStreamChunk(requestId, session, value ?? "", done);
      if (done) {
        postSessionComplete(requestId, session);
        return;
      }
    }
  } catch (error) {
    failure = { error };
  } finally {
    if (streamSession === session) {
      streamSession = null;
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

  if (message.type === "start-stream") {
    latestRequestId = message.requestId;
    streamSession = createStreamSession(
      message.format === "sse"
        ? createSseRecordStream()
        : createJsonlRecordStream(message.requestId, false),
    );
    return;
  }

  if (message.type === "file-jsonl") {
    latestRequestId = message.requestId;
    streamSession = createStreamSession(
      createJsonlRecordStream(message.requestId, true, message.file.name),
    );
    void parseJsonlFile(message.requestId, message.file, streamSession);
    return;
  }

  if (message.requestId !== latestRequestId || !streamSession) {
    return;
  }

  processStreamChunk(message.requestId, streamSession, message.chunk, message.done);

  if (message.done) {
    postSessionComplete(message.requestId, streamSession);
    streamSession = null;
  }
};

self.onmessage = (event: MessageEvent<ParserRequest>) => {
  try {
    handleRequest(event.data);
  } catch (error) {
    // Without this the failure surfaces as an uncaught worker exception and
    // the request never reaches a terminal state on the main thread.
    const session = streamSession;
    streamSession = null;
    postRequestError(event.data.requestId, session, error);
  }
};
