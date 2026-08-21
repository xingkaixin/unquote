import type {
  FullJsonlRecord,
  JsonlRecord,
  JsonlRecordIngestionLine,
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
