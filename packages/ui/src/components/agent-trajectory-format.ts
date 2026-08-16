import type { Locale, MessageKey } from "../i18n/i18n";
import type {
  AgentTrajectoryItemKind,
  AgentTrajectoryStatus,
  AgentTrajectoryWarning,
} from "../lib/agent-session";

export const trajectoryKindMessageKey: Record<AgentTrajectoryItemKind, MessageKey> = {
  user: "trajectory.kind.user",
  system: "trajectory.kind.system",
  assistant: "trajectory.kind.assistant",
  reasoning: "trajectory.kind.reasoning",
  tool: "trajectory.kind.tool",
  subagent: "trajectory.kind.subagent",
  compaction: "trajectory.kind.compaction",
};

export const trajectoryStatusMessageKey: Record<AgentTrajectoryStatus, MessageKey> = {
  completed: "trajectory.status.completed",
  running: "trajectory.status.running",
  failed: "trajectory.status.failed",
  aborted: "trajectory.status.aborted",
};

export const trajectoryWarningMessageKey = (warning: AgentTrajectoryWarning): MessageKey => {
  switch (warning.kind) {
    case "missing-timestamp":
      return "trajectory.warning.missingTimestamp";
    case "missing-turn-start":
      return "trajectory.warning.missingTurnStart";
    case "reversed-timestamp":
      return "trajectory.warning.reversedTimestamp";
    case "unpaired-tool-call":
      return "trajectory.warning.unpairedCall";
    case "unpaired-tool-result":
      return "trajectory.warning.unpairedResult";
    case "unpaired-tool-completion":
      return "trajectory.warning.unpairedCompletion";
    case "duplicate-tool-call-id":
      return "trajectory.warning.duplicateCall";
    case "duplicate-tool-result-id":
      return "trajectory.warning.duplicateResult";
    case "duplicate-tool-completion-id":
      return "trajectory.warning.duplicateCompletion";
    case "open-turn":
      return "trajectory.warning.openTurn";
    case "unattached-token-usage":
      return "trajectory.warning.unattachedTokens";
  }
};

export const formatTrajectoryDuration = (durationMs: number | undefined, locale: Locale) => {
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) {
    return "";
  }

  if (durationMs < 1_000) {
    return new Intl.NumberFormat(locale, {
      style: "unit",
      unit: "millisecond",
      unitDisplay: "narrow",
      maximumFractionDigits: 0,
    }).format(durationMs);
  }

  if (durationMs < 60_000) {
    return new Intl.NumberFormat(locale, {
      style: "unit",
      unit: "second",
      unitDisplay: "narrow",
      maximumFractionDigits: 1,
    }).format(durationMs / 1_000);
  }

  if (durationMs < 3_600_000) {
    return new Intl.NumberFormat(locale, {
      style: "unit",
      unit: "minute",
      unitDisplay: "narrow",
      maximumFractionDigits: 1,
    }).format(durationMs / 60_000);
  }

  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "hour",
    unitDisplay: "narrow",
    maximumFractionDigits: 1,
  }).format(durationMs / 3_600_000);
};
