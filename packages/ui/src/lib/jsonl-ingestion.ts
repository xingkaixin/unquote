import type {
  FullJsonlRecord,
  JsonlRecord,
  JsonlRecordLineResult,
  ParseResult,
  PreviewJsonlRecord,
} from "@unquote/core";
import { isParsed } from "@unquote/core";
import { createAgentSessionTracker } from "./agent-session";

export const createJsonlIngestion = (fileName?: string) => {
  const agentTracker = createAgentSessionTracker(fileName);
  let total = 0;
  let success = 0;

  const push = (
    parsedLine: JsonlRecordLineResult<FullJsonlRecord> | JsonlRecordLineResult<PreviewJsonlRecord>,
  ): JsonlRecord => {
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

    total += 1;
    if (isParsed(record)) {
      success += 1;
    }
    return record;
  };

  const stats = (): ParseResult["stats"] => ({
    total,
    success,
    failed: total - success,
  });

  return {
    push,
    stats,
    get processedLines() {
      return total;
    },
    finishAgentSession: () => agentTracker.finish(),
  };
};
