import type { ParseResult } from "@unquote/core";
import { parseInputForIngestion } from "@unquote/core/ingestion";
import type { AgentSession } from "./agent-session";
import { createJsonlIngestion } from "./jsonl-ingestion";
import type { ForcedFormat } from "./parse-text-result";

export { parseTextResult } from "./parse-text-result";
export type { ForcedFormat } from "./parse-text-result";

export interface ParserProgress {
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
  onAgentSessionDetected?: (() => void) | undefined;
}

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
    const ingestion = createJsonlIngestion(options.fileName, options.onAgentSessionDetected);
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
      elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
      done: true,
    },
  };
};
