import { parseInput } from "@unquote/core";
import type { ParseOptions, ParseResult } from "@unquote/core";
import { createAgentSessionFromText } from "./agent-session";
import type { AgentSession } from "./agent-session";

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
  const result = parseTextResult(input, options.forcedFormat);

  return {
    result,
    agentSession:
      result.format === "jsonl" ? createAgentSessionFromText(input, options.fileName) : null,
    progress: {
      processedLines: result.stats.total,
      success: result.stats.success,
      failed: result.stats.failed,
      elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
      done: true,
    },
  };
};
