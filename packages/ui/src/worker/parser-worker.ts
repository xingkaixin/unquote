import type { JsonlRecord, JsonNode, ParseResult } from "@unquote/core";
import {
  extractSummary,
  getJsonKind,
  parseInput,
  parseJson as parseJsonValue,
  parseJsonlRecordLine,
} from "@unquote/core";
import {
  createAgentSessionFromText,
  createAgentSessionTracker,
  type AgentSession,
} from "../lib/agent-session";
import { drainJsonlLines } from "../lib/jsonl-lines";

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
const maxDeferredStringLength = 160;
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

const isLikelyStringifiedJson = (value: string) => {
  const trimmed = value.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
};

const truncateTransferString = (value: string) =>
  value.length > maxDeferredStringLength ? value.slice(0, maxDeferredStringLength) : value;

const createDeferredNode = (
  value: unknown,
  path: string[],
  depth: number,
  recordId: string,
  sourceLine: number,
): JsonNode => {
  const kind = getJsonKind(value);
  const stringValue = typeof value === "string" ? value : null;
  const wasStringified = typeof stringValue === "string" && isLikelyStringifiedJson(stringValue);
  const nodeValue =
    stringValue === null
      ? kind === "object" || kind === "array"
        ? null
        : value
      : truncateTransferString(stringValue);
  const valueLength = stringValue?.length;

  return {
    kind: wasStringified ? "string" : kind,
    value: nodeValue,
    path,
    wasStringified,
    meta: {
      depth,
      expandable: kind === "object" || kind === "array" || wasStringified,
      restorable: wasStringified,
      recordId,
      sourceLine,
      ...(typeof valueLength === "number" && valueLength > maxDeferredStringLength
        ? { truncated: true, valueLength }
        : {}),
    },
  };
};

const parseDeferredJsonlRecordLine = (line: string, lineNumber: number): JsonlRecord => {
  try {
    const value = parseJsonValue(line);
    const id = `record-${lineNumber}`;
    const root = createDeferredNode(value, ["$"], 0, id, lineNumber);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      root.children = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, child]) => [
          key,
          createDeferredNode(child, ["$", key], 1, id, lineNumber),
        ]),
      );
    }

    return {
      id,
      lineNumber,
      node: root,
      deferred: true,
      summary: extractSummary(value),
    };
  } catch {
    return parseJsonlRecordLine(line, lineNumber);
  }
};

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

  session.agentTracker.pushRawLine(line, session.lineNumber);
  const record = session.compactForTransfer
    ? parseDeferredJsonlRecordLine(line, session.lineNumber)
    : parseJsonlRecordLine(line, session.lineNumber);
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
  const startedAt = performance.now();
  const result = parseInput(input, forcedFormat ? { forcedFormat } : {});
  const agentSession = result.format === "jsonl" ? createAgentSessionFromText(input) : null;
  self.postMessage({
    type: "complete",
    requestId,
    result,
    agentSession,
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
