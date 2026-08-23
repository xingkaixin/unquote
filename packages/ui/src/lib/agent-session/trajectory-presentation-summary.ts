import type {
  AgentTrajectoryPresentationItem,
  AgentTrajectoryPresentationSummary,
} from "./trajectory-presentation";
import { finiteTrajectoryNumber } from "./trajectory-time";
import type { AgentTrajectoryModel, AgentTrajectoryTurn } from "./trajectory-types";

const singlePointDomainDurationMs = 1;

const finiteNonNegativeNumber = (value: number | undefined) => {
  const number = finiteTrajectoryNumber(value);
  return number !== undefined && number >= 0 ? number : undefined;
};

const sumKnownTurnDurations = (turns: readonly AgentTrajectoryTurn[]) => {
  let hasDuration = false;
  let total = 0;
  for (const turn of turns) {
    const duration = finiteNonNegativeNumber(turn.durationMs);
    if (duration === undefined) {
      continue;
    }
    hasDuration = true;
    total = Math.min(Number.MAX_VALUE, total + duration);
  }
  return hasDuration ? total : undefined;
};

const summaryTokenKeys = [
  "inputTokens",
  "outputTokens",
  "cacheCreationInputTokens",
  "cacheReadInputTokens",
  "reasoningOutputTokens",
] as const;

export const createTrajectoryPresentationSummary = (
  trajectory: AgentTrajectoryModel,
  toolCount: number,
  failedToolCount: number,
): AgentTrajectoryPresentationSummary => {
  const tokens: Partial<Record<(typeof summaryTokenKeys)[number], number>> = {};
  for (const key of summaryTokenKeys) {
    const value = finiteNonNegativeNumber(trajectory.stats.tokenUsage[key]);
    if (value !== undefined) {
      tokens[key] = value;
    }
  }
  const durationMs = sumKnownTurnDurations(trajectory.turns);
  return {
    turns: trajectory.turns.length,
    events: trajectory.items.length,
    tools: toolCount,
    failures: failedToolCount,
    ...(durationMs === undefined ? {} : { durationMs }),
    tokens,
    warningCount: trajectory.warnings.length,
  };
};

const addDomainPoint = (domain: { start?: number; end?: number }, value: number | undefined) => {
  const point = finiteTrajectoryNumber(value);
  if (point === undefined) {
    return;
  }
  domain.start = domain.start === undefined ? point : Math.min(domain.start, point);
  domain.end = domain.end === undefined ? point : Math.max(domain.end, point);
};

export const createTrajectoryTimeDomain = (
  items: readonly AgentTrajectoryPresentationItem[],
  turns: readonly AgentTrajectoryTurn[],
) => {
  const domain: { start?: number; end?: number } = {};
  for (const item of items) {
    addDomainPoint(domain, item.interval?.start);
    addDomainPoint(domain, item.interval?.end);
  }
  for (const turn of turns) {
    addDomainPoint(domain, turn.startedAt);
    addDomainPoint(domain, turn.endedAt);
  }
  if (domain.start === undefined || domain.end === undefined) {
    return null;
  }
  if (domain.start !== domain.end) {
    return { start: domain.start, end: domain.end };
  }
  const expandedEnd = domain.end + singlePointDomainDurationMs;
  if (Number.isFinite(expandedEnd) && expandedEnd > domain.end) {
    return { start: domain.start, end: expandedEnd };
  }
  const expandedStart = domain.start - singlePointDomainDurationMs;
  return Number.isFinite(expandedStart) && expandedStart < domain.start
    ? { start: expandedStart, end: domain.end }
    : { start: domain.start, end: domain.end };
};
