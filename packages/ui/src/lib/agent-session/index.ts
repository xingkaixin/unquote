import type {
  AgentAdapterBuilder,
  AgentParseWarning,
  AgentSessionAdapter,
  ParsedAgentLine,
} from "./types";
import { claudeTranscriptAdapter } from "./claude-adapter";
import { codexRolloutAdapter } from "./codex-adapter";

export type {
  AgentContentBlock,
  AgentConversationItem,
  AgentConversationEntry,
  AgentConversationRole,
  AgentDetailSelection,
  AgentEventCategory,
  AgentParseWarning,
  AgentSession,
  AgentSessionDetail,
  AgentSessionIntegrityIssue,
  AgentSessionMeta,
  AgentSessionModel,
  AgentTimelineEvent,
  AgentTokenUsage,
  AgentToolStatus,
  ParsedAgentLine,
} from "./types";
export { createAgentSessionModel } from "./model";

const detectionLineLimit = 80;
const earlyDetectionLineCount = 20;
const confidentDetectionScore = 0.75;
const finalDetectionScore = 0.5;

const adapters: AgentSessionAdapter[] = [codexRolloutAdapter, claudeTranscriptAdapter];

const selectAdapter = (samples: ParsedAgentLine[], minScore: number) => {
  let bestAdapter: AgentSessionAdapter | null = null;
  let bestScore = 0;

  for (const adapter of adapters) {
    const score = adapter.detect(samples);
    if (score > bestScore) {
      bestScore = score;
      bestAdapter = adapter;
    }
  }

  return bestAdapter && bestScore >= minScore ? bestAdapter : null;
};

export const createAgentSessionTracker = (fileName?: string) => {
  const samples: ParsedAgentLine[] = [];
  const parseWarnings: AgentParseWarning[] = [];
  let builder: AgentAdapterBuilder | null = null;
  let disabled = false;

  const startBuilder = (adapter: AgentSessionAdapter) => {
    builder = adapter.createBuilder(fileName);
    for (const sample of samples) {
      builder.push(sample);
    }
    samples.splice(0, samples.length);
  };

  const tryDetect = (minScore: number) => {
    const adapter = selectAdapter(samples, minScore);
    if (adapter) {
      startBuilder(adapter);
      return true;
    }
    return false;
  };

  const pushParsedLine = (line: ParsedAgentLine) => {
    if (disabled) {
      return;
    }

    if (builder) {
      builder.push(line);
      return;
    }

    samples.push(line);
    if (samples.length >= earlyDetectionLineCount && tryDetect(confidentDetectionScore)) {
      return;
    }
    if (samples.length >= detectionLineLimit && !tryDetect(finalDetectionScore)) {
      disabled = true;
      samples.splice(0, samples.length);
    }
  };

  const pushParseWarning = (lineNumber: number) => {
    if (!disabled) {
      parseWarnings.push({ lineNumber, message: "Invalid JSON on this line" });
    }
  };

  return {
    pushParsedLine,
    pushParseWarning,
    pushRawLine(raw: string, lineNumber: number) {
      if (disabled || !raw.trim()) {
        return;
      }

      try {
        pushParsedLine({ lineNumber, data: JSON.parse(raw) as unknown });
      } catch {
        pushParseWarning(lineNumber);
      }
    },

    finish() {
      if (!builder && !disabled) {
        tryDetect(finalDetectionScore);
      }
      return builder ? builder.finish(parseWarnings) : null;
    },
  };
};

export const createAgentSessionFromText = (text: string, fileName?: string) => {
  const tracker = createAgentSessionTracker(fileName);
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => tracker.pushRawLine(line.trim(), index + 1));
  return tracker.finish();
};
