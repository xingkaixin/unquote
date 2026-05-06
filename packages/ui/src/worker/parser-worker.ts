import type { JsonlRecord, ParseResult } from "@unquote/core";
import { parseInput, parseJsonlRecordLine } from "@unquote/core";

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

export interface ParserProgress {
  processedLines: number;
  success: number;
  failed: number;
  elapsedMs: number;
  done: boolean;
}

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
}

let jsonlSession: JsonlSession | null = null;

const createJsonlSession = (): JsonlSession => ({
  startedAt: performance.now(),
  buffer: "",
  lineNumber: 1,
  batch: [],
  processedLines: 0,
  success: 0,
  failed: 0,
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

const postBatch = (requestId: number, session: JsonlSession, done: boolean) => {
  if (session.batch.length === 0) {
    return;
  }

  self.postMessage({
    type: "batch",
    requestId,
    records: session.batch.splice(0, session.batch.length),
    stats: statsFromSession(session),
    progress: progressFromSession(session, done),
  } satisfies ParserWorkerResponse);
};

const parseJsonlLine = (requestId: number, session: JsonlSession, line: string) => {
  if (!line.trim()) {
    session.lineNumber += 1;
    return;
  }

  const record = parseJsonlRecordLine(line, session.lineNumber);
  session.processedLines += 1;
  session.lineNumber += 1;
  if (record.node) {
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
  session.buffer += chunk;

  let newlineIndex = session.buffer.indexOf("\n");
  while (newlineIndex >= 0) {
    const rawLine = session.buffer.slice(0, newlineIndex);
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    parseJsonlLine(requestId, session, line);
    session.buffer = session.buffer.slice(newlineIndex + 1);
    newlineIndex = session.buffer.indexOf("\n");
  }

  if (done && session.buffer) {
    parseJsonlLine(requestId, session, session.buffer);
    session.buffer = "";
  }

  postBatch(requestId, session, done);
};

const parseJson = ({
  requestId,
  input,
  forcedFormat,
}: Extract<ParserRequest, { type: "parse" }>) => {
  const startedAt = performance.now();
  const result = parseInput(input, forcedFormat ? { forcedFormat } : {});
  self.postMessage({
    type: "complete",
    requestId,
    result,
    progress: {
      processedLines: result.stats.total,
      success: result.stats.success,
      failed: result.stats.failed,
      elapsedMs: elapsed(startedAt),
      done: true,
    },
  } satisfies ParserWorkerResponse);
};

const parseJsonlFile = async (requestId: number, file: File, session: JsonlSession) => {
  const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();

  while (true) {
    if (requestId !== latestRequestId) {
      await reader.cancel();
      return;
    }

    const { value, done } = await reader.read();
    if (requestId !== latestRequestId) {
      await reader.cancel();
      return;
    }

    processJsonlChunk(requestId, session, value ?? "", done);
    if (done) {
      self.postMessage({
        type: "complete",
        requestId,
        stats: statsFromSession(session),
        progress: progressFromSession(session, true),
      } satisfies ParserWorkerResponse);
      return;
    }
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
    jsonlSession = createJsonlSession();
    void parseJsonlFile(message.requestId, message.file, jsonlSession);
    return;
  }

  if (message.requestId !== latestRequestId || !jsonlSession) {
    return;
  }

  processJsonlChunk(message.requestId, jsonlSession, message.chunk, message.done);

  if (message.done) {
    const session = jsonlSession;
    self.postMessage({
      type: "complete",
      requestId: message.requestId,
      stats: statsFromSession(session),
      progress: progressFromSession(session, true),
    } satisfies ParserWorkerResponse);
    jsonlSession = null;
  }
};
