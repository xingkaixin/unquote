import type { AgentTrajectoryTokenUsage } from "./session-types";

const tokenKeys = [
  "inputTokens",
  "cacheCreationInputTokens",
  "cacheReadInputTokens",
  "outputTokens",
  "reasoningOutputTokens",
] as const;

export type AgentTrajectoryTokenUsageDraft = Partial<Record<(typeof tokenKeys)[number], number>>;

const safeTokenCount = (value: number | undefined) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

export const validTokenUsage = (
  usage: AgentTrajectoryTokenUsage | undefined,
): AgentTrajectoryTokenUsageDraft | undefined => {
  if (!usage) {
    return undefined;
  }

  const valid: AgentTrajectoryTokenUsageDraft = {};
  let hasComponent = false;

  for (const key of tokenKeys) {
    const value = safeTokenCount(usage[key]);
    if (value !== undefined) {
      valid[key] = value;
      hasComponent = true;
    }
  }

  return hasComponent ? valid : undefined;
};

export const mergeTokenUsage = (
  current: AgentTrajectoryTokenUsage | undefined,
  next: AgentTrajectoryTokenUsage,
): AgentTrajectoryTokenUsageDraft | undefined => {
  const merged: AgentTrajectoryTokenUsageDraft = current ? { ...current } : {};
  let hasComponent = false;

  for (const key of tokenKeys) {
    if (merged[key] !== undefined) {
      hasComponent = true;
    }
    const value = next[key];
    if (value === undefined) {
      continue;
    }
    const existing = merged[key];
    const total = existing === undefined ? value : existing + value;
    if (!Number.isSafeInteger(total)) {
      continue;
    }
    merged[key] = total;
    hasComponent = true;
  }

  return hasComponent ? merged : undefined;
};

export const mergeTotalTokenUsage = (
  total: AgentTrajectoryTokenUsageDraft,
  usage: AgentTrajectoryTokenUsageDraft | undefined,
  cumulativeUsage: AgentTrajectoryTokenUsageDraft | undefined,
) => {
  for (const key of tokenKeys) {
    const cumulativeValue = cumulativeUsage?.[key];
    if (cumulativeValue !== undefined) {
      total[key] = cumulativeValue;
      continue;
    }

    const usageValue = usage?.[key];
    if (usageValue === undefined) {
      continue;
    }

    const existing = total[key];
    const next = existing === undefined ? usageValue : existing + usageValue;
    if (Number.isSafeInteger(next)) {
      total[key] = next;
    }
  }
};
