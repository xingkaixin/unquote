import type {
  AgentTrajectoryPresentationItem,
  AgentTrajectoryPresentationSummary,
  AgentTrajectoryToolSummary,
} from "./trajectory-presentation-types";
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

interface MutableToolSummary {
  toolName: string;
  calls: number;
  failures: number;
  timedCalls: number;
  totalDurationMs?: number;
  maxDurationMs?: number;
}

const summarizeTools = (items: AgentTrajectoryModel["items"]) => {
  let tools = 0;
  let failures = 0;
  const summaryByName = new Map<string, MutableToolSummary>();
  for (const item of items) {
    if (item.kind !== "tool") {
      continue;
    }
    tools += 1;
    const failed = item.status === "failed";
    if (failed) {
      failures += 1;
    }
    if (!item.toolName) {
      continue;
    }
    let summary = summaryByName.get(item.toolName);
    if (!summary) {
      summary = { toolName: item.toolName, calls: 0, failures: 0, timedCalls: 0 };
      summaryByName.set(item.toolName, summary);
    }
    summary.calls += 1;
    if (failed) {
      summary.failures += 1;
    }
    const duration = finiteNonNegativeNumber(item.durationMs);
    if (duration !== undefined) {
      summary.timedCalls += 1;
      summary.totalDurationMs = Math.min(
        Number.MAX_VALUE,
        (summary.totalDurationMs ?? 0) + duration,
      );
      summary.maxDurationMs = Math.max(summary.maxDurationMs ?? 0, duration);
    }
  }
  const toolSummaries: AgentTrajectoryToolSummary[] = [...summaryByName.values()].sort(
    (left, right) =>
      right.calls - left.calls ||
      (left.toolName < right.toolName ? -1 : left.toolName > right.toolName ? 1 : 0),
  );
  return { tools, failures, toolSummaries };
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
): AgentTrajectoryPresentationSummary => {
  const tokens: Partial<Record<(typeof summaryTokenKeys)[number], number>> = {};
  for (const key of summaryTokenKeys) {
    const value = finiteNonNegativeNumber(trajectory.stats.tokenUsage[key]);
    if (value !== undefined) {
      tokens[key] = value;
    }
  }
  const durationMs = sumKnownTurnDurations(trajectory.turns);
  const { tools, failures, toolSummaries } = summarizeTools(trajectory.items);
  return {
    turns: trajectory.turns.length,
    events: trajectory.items.length,
    tools,
    failures,
    toolSummaries,
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
