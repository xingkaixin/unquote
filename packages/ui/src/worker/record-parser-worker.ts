import { parseJsonlRecordLine } from "@unquote/core";
import type { JsonlRecord } from "@unquote/core";

export interface RecordParserRequest {
  requestId: number;
  lines: Map<number, string>;
}

export type RecordParserResponse =
  | { type: "result"; requestId: number; records: Map<number, JsonlRecord> }
  | { type: "error"; requestId: number };

self.onmessage = ({ data }: MessageEvent<RecordParserRequest>) => {
  try {
    const records = new Map(
      [...data.lines].map(([lineNumber, line]) => [
        lineNumber,
        parseJsonlRecordLine(line, lineNumber),
      ]),
    );
    self.postMessage({
      type: "result",
      requestId: data.requestId,
      records,
    } satisfies RecordParserResponse);
  } catch {
    self.postMessage({ type: "error", requestId: data.requestId } satisfies RecordParserResponse);
  }
};
