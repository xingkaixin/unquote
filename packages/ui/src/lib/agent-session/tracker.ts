import { claudeTranscriptAdapter } from "./claude-adapter";
import { codexRolloutAdapter } from "./codex-adapter";
import { getString, isRecord } from "./shared";
import type {
  AgentAdapterBuilder,
  AgentDetectionSample,
  AgentParseWarning,
  AgentSessionAdapter,
  ParsedAgentLine,
} from "./types";

const detectionLineLimit = 80;
const earlyDetectionLineCount = 20;
const confidentDetectionScore = 0.75;
const finalDetectionScore = 0.5;
const parseWarningDetailLimit = 100;

const adapters: AgentSessionAdapter[] = [codexRolloutAdapter, claudeTranscriptAdapter];

const selectAdapter = (samples: AgentDetectionSample[], minScore: number) => {
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

interface WarningBuffer {
  details: AgentParseWarning[];
  totalCount: number;
}

interface DetectionCandidate {
  adapter: AgentSessionAdapter;
  builder: AgentAdapterBuilder;
  warnings: WarningBuffer;
}

interface DeferredParsedAgentLine extends Pick<ParsedAgentLine, "recordId" | "lineNumber"> {
  materializeData: () => unknown;
}

type DetectionStatus = "collecting" | "detected" | "disabled";

const emptyDetectionSample: AgentDetectionSample = {
  type: undefined,
  hasObjectPayload: false,
  hasUuid: false,
  hasObjectMessage: false,
  hasSessionId: false,
};

const createDetectionSample = (data: unknown): AgentDetectionSample => {
  if (!isRecord(data)) {
    return emptyDetectionSample;
  }

  return {
    type: getString(data, "type"),
    hasObjectPayload: isRecord(data.payload),
    hasUuid: getString(data, "uuid") !== undefined,
    hasObjectMessage: isRecord(data.message),
    hasSessionId: getString(data, "sessionId") !== undefined,
  };
};

const appendWarning = (buffer: WarningBuffer, warning: AgentParseWarning) => {
  buffer.totalCount += 1;
  if (buffer.details.length < parseWarningDetailLimit) {
    buffer.details.push(warning);
  }
};

export const createAgentSessionTracker = (fileName?: string) => {
  const samples: AgentDetectionSample[] = [];
  let candidates: DetectionCandidate[] = adapters.map((adapter) => ({
    adapter,
    builder: adapter.createBuilder(fileName),
    warnings: { details: [], totalCount: 0 },
  }));
  let status: DetectionStatus = "collecting";

  const pushToCandidate = (candidate: DetectionCandidate, line: ParsedAgentLine) => {
    try {
      candidate.builder.push(line);
    } catch {
      appendWarning(candidate.warnings, {
        kind: "projection-failed",
        recordId: line.recordId,
        lineNumber: line.lineNumber,
      });
    }
  };

  const disable = () => {
    status = "disabled";
    candidates = [];
    samples.splice(0, samples.length);
  };

  const tryDetect = (minScore: number) => {
    const adapter = selectAdapter(samples, minScore);
    if (!adapter) {
      return false;
    }

    const selectedCandidate = candidates.find((candidate) => candidate.adapter === adapter);
    if (!selectedCandidate) {
      return false;
    }

    status = "detected";
    candidates = [selectedCandidate];
    samples.splice(0, samples.length);
    return true;
  };

  const evaluateDetection = () => {
    if (samples.length >= earlyDetectionLineCount && tryDetect(confidentDetectionScore)) {
      return;
    }
    if (samples.length >= detectionLineLimit && !tryDetect(finalDetectionScore)) {
      disable();
    }
  };

  const pushParsedLine = (input: ParsedAgentLine | DeferredParsedAgentLine) => {
    if (status === "disabled") {
      return;
    }
    const line: ParsedAgentLine =
      "materializeData" in input
        ? {
            recordId: input.recordId,
            lineNumber: input.lineNumber,
            data: input.materializeData(),
          }
        : input;

    for (const candidate of candidates) {
      pushToCandidate(candidate, line);
    }

    if (status === "detected") {
      return;
    }

    samples.push(createDetectionSample(line.data));
    evaluateDetection();
  };

  const pushParseWarning = ({
    recordId,
    lineNumber,
  }: Pick<ParsedAgentLine, "recordId" | "lineNumber">) => {
    if (status === "disabled") {
      return;
    }

    for (const candidate of candidates) {
      appendWarning(candidate.warnings, { kind: "invalid-json", recordId, lineNumber });
    }

    if (status === "collecting") {
      samples.push(emptyDetectionSample);
      evaluateDetection();
    }
  };

  return {
    pushParsedLine,
    pushParseWarning,
    get needsParsedValues() {
      return status !== "disabled";
    },
    finish() {
      if (status === "collecting" && !tryDetect(finalDetectionScore)) {
        disable();
      }
      if (status !== "detected") {
        return null;
      }

      const candidate = candidates[0]!;
      const session = candidate.builder.finish(candidate.warnings.details);
      return { ...session, parseWarningCount: candidate.warnings.totalCount };
    },
  };
};
