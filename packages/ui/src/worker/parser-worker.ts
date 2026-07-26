import type { JsonlRecord, ParseResult } from "@unquote/core";
import {
  isParsed,
  parseJsonlRecordLineWithValue,
  parsePreviewJsonlRecordLineWithValue,
} from "@unquote/core";
import { createAgentSessionTracker, type AgentSession } from "../lib/agent-session";
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
      type: "batch";
      requestId: number;
      records: JsonlRecord[];
      stats: ParseResult["stats"];
      progress: ParserProgress;
    }
  | {
      type: "complete";
      requestId: number;
      result?: ParseResult;
      stats?: ParseResult["stats"];
      agentSession?: AgentSession | null;
      progress: ParserProgress;
    }
  | {
      type: "error";
      requestId: number;
      stats: ParseResult["stats"];
      progress: ParserProgress;
    };

const batchSize = 64;
let latestRequestId = 0;

const elapsed = (startedAt: number) => Number((performance.now() - startedAt).toFixed(2));

interface JsonlSession {
  startedAt: number;
  buffer: string;
  lineNumber: number;
  batch: JsonlRecord[];
  processedLines: number;
  success: number;
  failed: number;
  compactForTransfer: boolean;
  agentTracker: ReturnType<typeof createAgentSessionTracker>;
}

let jsonlSession: JsonlSession | null = null;

const createJsonlSession = (compactForTransfer = false, fileName?: string): JsonlSession => ({
  startedAt: performance.now(),
  buffer: "",
  lineNumber: 1,
  batch: [],
  processedLines: 0,
  success: 0,
  failed: 0,
  compactForTransfer,
  agentTracker: createAgentSessionTracker(fileName),
});

const statsFromSession = (session: JsonlSession) => ({
  total: session.processedLines,
  success: session.success,
  failed: session.failed,
});

const progressFromSession = (session: JsonlSession, done: boolean): ParserProgress => ({
  processedLines: session.processedLines,
  success: session.success,
  failed: session.failed,
  elapsedMs: elapsed(session.startedAt),
  done,
});

const postSessionComplete = (requestId: number, session: JsonlSession) => {
  self.postMessage({
    type: "complete",
    requestId,
    stats: statsFromSession(session),
    agentSession: session.agentTracker.finish(),
    progress: progressFromSession(session, true),
  } satisfies ParserWorkerResponse);
};

const postSessionError = (requestId: number, session: JsonlSession) => {
  self.postMessage({
    type: "error",
    requestId,
    stats: statsFromSession(session),
    progress: progressFromSession(session, true),
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

  const parsedLine = session.compactForTransfer
    ? parsePreviewJsonlRecordLineWithValue(line, session.lineNumber)
    : parseJsonlRecordLineWithValue(line, session.lineNumber);
  if ("value" in parsedLine) {
    session.agentTracker.pushParsedLine({
      lineNumber: session.lineNumber,
      data: parsedLine.value,
    });
  } else {
    session.agentTracker.pushParseWarning(session.lineNumber);
  }
  const { record } = parsedLine;
  session.processedLines += 1;
  session.lineNumber += 1;
  if (isParsed(record)) {
    session.success += 1;
  } else {
    session.failed += 1;
  }
  session.batch.push(record);

  if (session.processedLines === 1 || session.batch.length >= batchSize) {
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
  const { result, agentSession, progress } = parseText(input, { forcedFormat });
  self.postMessage({
    type: "complete",
    requestId,
    result,
    agentSession,
    progress,
  } satisfies ParserWorkerResponse);
};

const parseJsonlFile = async (requestId: number, file: File, session: JsonlSession) => {
  let reader: ReadableStreamDefaultReader<string> | null = null;
  let failed = false;

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
  } catch {
    failed = true;
  } finally {
    if (jsonlSession === session) {
      jsonlSession = null;
    }
    await reader?.cancel().catch(() => undefined);
  }

  if (failed && requestId === latestRequestId) {
    postSessionError(requestId, session);
  }
};

self.onmessage = (event: MessageEvent<ParserRequest>) => {
  const message = event.data;

  if (message.type === "parse") {
    latestRequestId = message.requestId;
    parseJson(message);
    return;
  }

  if (message.type === "start-jsonl") {
    latestRequestId = message.requestId;
    jsonlSession = createJsonlSession();
    return;
  }

  if (message.type === "file-jsonl") {
    latestRequestId = message.requestId;
    jsonlSession = createJsonlSession(true, message.file.name);
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
