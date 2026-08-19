const SINGLE_POINT_DOMAIN_DURATION_MS = 1;

export interface AgentTrajectoryTimeRange {
  readonly start: number;
  readonly end: number;
}

export const finiteTrajectoryNumber = (value: number | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

export const validTrajectoryRange = (
  range: AgentTrajectoryTimeRange | null | undefined,
): AgentTrajectoryTimeRange | null => {
  const start = finiteTrajectoryNumber(range?.start);
  const end = finiteTrajectoryNumber(range?.end);
  return start === undefined || end === undefined || start > end ? null : { start, end };
};

export const trajectoryRangesOverlap = (
  left: AgentTrajectoryTimeRange,
  right: AgentTrajectoryTimeRange,
) => left.start <= right.end && left.end >= right.start;

export const clampTrajectoryRangeToDomain = (
  domain: AgentTrajectoryTimeRange,
  range: AgentTrajectoryTimeRange | null | undefined,
) => {
  const requested = validTrajectoryRange(range);
  if (!requested) {
    return domain;
  }
  const start = Math.max(domain.start, requested.start);
  const end = Math.min(domain.end, requested.end);
  return start <= end ? { start, end } : domain;
};

export const expandedTrajectoryDomain = (domain: AgentTrajectoryTimeRange | null) => {
  const valid = validTrajectoryRange(domain);
  if (!valid) {
    return null;
  }
  if (valid.start !== valid.end) {
    return valid;
  }
  const end = valid.end + SINGLE_POINT_DOMAIN_DURATION_MS;
  return Number.isFinite(end) && end > valid.end ? { start: valid.start, end } : valid;
};
