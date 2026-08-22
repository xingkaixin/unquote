import { parseInput } from "@unquote/core";
import type { ParseOptions, ParseResult } from "@unquote/core";
import { parseInputForIngestion } from "@unquote/core/ingestion";
import type { AgentSession } from "./agent-session";
import { createJsonlIngestion } from "./jsonl-ingestion";

export type ForcedFormat = NonNullable<ParseOptions["forcedFormat"]>;

export interface ParserProgress {
  processedLines: number;
  success: number;
  failed: number;
  elapsedMs: number;
  done: boolean;
}

export interface ParsedText {
  result: ParseResult;
  agentSession: AgentSession | null;
  progress: ParserProgress;
}

interface ParseTextOptions {
  forcedFormat?: ForcedFormat | undefined;
  fileName?: string | undefined;
}

export const parseTextResult = (input: string, forcedFormat?: ForcedFormat) =>
  parseInput(input, forcedFormat ? { forcedFormat } : {});

export const parseText = (input: string, options: ParseTextOptions = {}): ParsedText => {
  const startedAt = performance.now();
  const parsed = parseInputForIngestion(
    input,
    options.forcedFormat ? { forcedFormat: options.forcedFormat } : {},
  );
  let result: ParseResult;
  let agentSession: AgentSession | null;
  if (parsed.format === "json") {
    result = parsed.result;
    agentSession = null;
  } else {
    const ingestion = createJsonlIngestion(options.fileName);
    result = {
      format: "jsonl",
      records: parsed.lines.map(ingestion.push),
      stats: ingestion.stats(),
    };
    agentSession = ingestion.finishAgentSession();
  }

  return {
    result,
    agentSession,
    progress: {
      processedLines: result.stats.total,
      success: result.stats.success,
      failed: result.stats.failed,
      elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
      done: true,
    },
  };
};
