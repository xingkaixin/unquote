import type { FullJsonlRecord, JsonlRecord, ParseResult, PreviewJsonlRecord } from "@unquote/core";
import { isParsed, parseJsonlRecordLine, parsePreviewJsonlRecordLine } from "@unquote/core";
import type { JsonlRecordIngestionLine, JsonlRecordLineResult } from "@unquote/core/ingestion";
import {
  parseJsonlRecordLineWithValue,
  parsePreviewJsonlRecordLineWithValue,
} from "@unquote/core/ingestion";
import { createAgentSessionTracker } from "./agent-session/tracker";

export const createJsonlIngestion = (
  fileName?: string,
  onAgentSessionDetected?: (() => void) | undefined,
) => {
  const agentTracker = createAgentSessionTracker(fileName, onAgentSessionDetected);
  let total = 0;
  let success = 0;

  const commitRecord = (record: JsonlRecord) => {
    total += 1;
    if (isParsed(record)) {
      success += 1;
    }
    return record;
  };

  const pushMaterialized = (
    parsedLine: JsonlRecordLineResult<FullJsonlRecord> | JsonlRecordLineResult<PreviewJsonlRecord>,
  ) => {
    const { record } = parsedLine;
    if ("value" in parsedLine) {
      agentTracker.pushParsedLine({
        recordId: record.id,
        lineNumber: record.lineNumber,
        data: parsedLine.value,
      });
    } else {
      agentTracker.pushParseWarning({ recordId: record.id, lineNumber: record.lineNumber });
    }
    return commitRecord(record);
  };

  const push = (
    parsedLine:
      | JsonlRecordIngestionLine<FullJsonlRecord>
      | JsonlRecordIngestionLine<PreviewJsonlRecord>,
  ): JsonlRecord => {
    const { record } = parsedLine;
    if ("materializeValue" in parsedLine) {
      agentTracker.pushParsedLine({
        recordId: record.id,
        lineNumber: record.lineNumber,
        materializeData: parsedLine.materializeValue,
      });
    } else {
      agentTracker.pushParseWarning({ recordId: record.id, lineNumber: record.lineNumber });
    }
    return commitRecord(record);
  };

  const ingestFullLine = (line: string, lineNumber: number) =>
    agentTracker.needsParsedValues
      ? pushMaterialized(parseJsonlRecordLineWithValue(line, lineNumber))
      : commitRecord(parseJsonlRecordLine(line, lineNumber));

  const ingestPreviewLine = (line: string, lineNumber: number) =>
    agentTracker.needsParsedValues
      ? pushMaterialized(parsePreviewJsonlRecordLineWithValue(line, lineNumber))
      : commitRecord(parsePreviewJsonlRecordLine(line, lineNumber));

  const stats = (): ParseResult["stats"] => ({
    total,
    success,
    failed: total - success,
  });

  return {
    push,
    ingestFullLine,
    ingestPreviewLine,
    stats,
    get processedLines() {
      return total;
    },
    finishAgentSession: () => agentTracker.finish(),
  };
};
