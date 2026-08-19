import type {
  AgentTrajectoryPresentation,
  AgentTrajectoryPresentationItem,
} from "./trajectory-presentation";
import {
  clampTrajectoryRangeToDomain,
  expandedTrajectoryDomain,
  finiteTrajectoryNumber,
  trajectoryRangesOverlap,
  type AgentTrajectoryTimeRange,
  validTrajectoryRange,
} from "./trajectory-time";

// An idle stretch must span at least this fraction of the viewport before the
// axis compresses it — high enough that ordinary pauses between sparse events
// never fold — and it then occupies this much of the compressed width.
const TIME_SCALE_GAP_MIN_FRACTION = 0.25;
const TIME_SCALE_GAP_MIN_MS = 60_000;
const TIME_SCALE_GAP_COMPRESSED_FRACTION = 0.03;

export interface TrajectoryTimeScale {
  readonly viewport: AgentTrajectoryTimeRange;
  // Idle stretches (in real time) that the axis compresses.
  readonly gaps: readonly AgentTrajectoryTimeRange[];
  readonly toRatio: (time: number) => number;
  readonly fromRatio: (ratio: number) => number;
}

interface TimeScaleSegment {
  readonly start: number;
  readonly end: number;
  readonly weight: number;
  readonly cumulativeBefore: number;
}

const linearTimeScale = (
  viewport: AgentTrajectoryTimeRange,
  span: number,
): TrajectoryTimeScale => ({
  viewport,
  gaps: [],
  toRatio: (time) => Math.min(1, Math.max(0, (time - viewport.start) / span)),
  fromRatio: (ratio) => viewport.start + Math.min(1, Math.max(0, ratio)) * span,
});

/**
 * A piecewise-linear axis over the viewport: stretches with no observed
 * activity longer than a quarter of the viewport collapse to a sliver so the
 * active clusters get the horizontal space instead of real idle time.
 */
export const createTrajectoryTimeScale = (
  presentation: AgentTrajectoryPresentation,
  viewport: AgentTrajectoryTimeRange | null,
): TrajectoryTimeScale | null => {
  const active = validTrajectoryRange(viewport);
  if (!active) {
    return null;
  }
  const span = active.end - active.start;
  if (!Number.isFinite(span) || span <= 0) {
    return null;
  }

  const covered: { start: number; end: number }[] = [];
  for (const item of presentation.items) {
    if (!item.interval || !trajectoryRangesOverlap(item.interval, active)) {
      continue;
    }
    covered.push({
      start: Math.max(active.start, item.interval.start),
      end: Math.min(active.end, item.interval.end),
    });
  }
  for (const group of presentation.groups) {
    for (const time of [group.turn?.startedAt, group.turn?.endedAt]) {
      const point = finiteTrajectoryNumber(time);
      if (point !== undefined && point >= active.start && point <= active.end) {
        covered.push({ start: point, end: point });
      }
    }
  }
  if (covered.length === 0) {
    return linearTimeScale(active, span);
  }

  covered.sort((left, right) => left.start - right.start);
  const minGap = Math.max(span * TIME_SCALE_GAP_MIN_FRACTION, TIME_SCALE_GAP_MIN_MS);
  const gaps: AgentTrajectoryTimeRange[] = [];
  let coveredUntil = active.start;
  for (const range of covered) {
    if (range.start - coveredUntil > minGap) {
      gaps.push({ start: coveredUntil, end: range.start });
    }
    coveredUntil = Math.max(coveredUntil, range.end);
  }
  if (active.end - coveredUntil > minGap) {
    gaps.push({ start: coveredUntil, end: active.end });
  }
  if (gaps.length === 0) {
    return linearTimeScale(active, span);
  }

  // Each gap should occupy a fixed share of the *compressed* width, so solve
  // w / (activeWeight + gapCount * w) = share for the gap weight w.
  const gapShare = TIME_SCALE_GAP_COMPRESSED_FRACTION;
  const activeWeight = span - gaps.reduce((total, gap) => total + (gap.end - gap.start), 0);
  const compressedWeight =
    activeWeight > 0 && gaps.length * gapShare < 1
      ? (gapShare * activeWeight) / (1 - gaps.length * gapShare)
      : span * gapShare;
  const segments: TimeScaleSegment[] = [];
  let cursor = active.start;
  let cumulative = 0;
  const pushSegment = (start: number, end: number, weight: number) => {
    if (end <= start) {
      return;
    }
    segments.push({ start, end, weight, cumulativeBefore: cumulative });
    cumulative += weight;
  };
  for (const gap of gaps) {
    pushSegment(cursor, gap.start, gap.start - cursor);
    pushSegment(gap.start, gap.end, compressedWeight);
    cursor = gap.end;
  }
  pushSegment(cursor, active.end, active.end - cursor);
  const totalWeight = cumulative;
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
    return linearTimeScale(active, span);
  }

  const toRatio = (time: number) => {
    const clamped = Math.min(active.end, Math.max(active.start, time));
    for (const segment of segments) {
      if (clamped <= segment.end) {
        const within = (clamped - segment.start) / (segment.end - segment.start);
        return (segment.cumulativeBefore + within * segment.weight) / totalWeight;
      }
    }
    return 1;
  };
  const fromRatio = (ratio: number) => {
    const target = Math.min(1, Math.max(0, ratio)) * totalWeight;
    for (const segment of segments) {
      if (target <= segment.cumulativeBefore + segment.weight) {
        const within =
          segment.weight > 0 ? (target - segment.cumulativeBefore) / segment.weight : 0;
        return segment.start + within * (segment.end - segment.start);
      }
    }
    return active.end;
  };

  return { viewport: active, gaps, toRatio, fromRatio };
};

export interface AgentTrajectoryOverviewSpan {
  readonly item: AgentTrajectoryPresentationItem;
  // Position within the viewport, both clamped to [0, 1].
  readonly startRatio: number;
  readonly endRatio: number;
}

/**
 * Projects each timed item inside the viewport onto viewport-relative ratios,
 * or returns null when more than `limit` items intersect it — the signal to
 * fall back to bucket aggregation.
 */
export const trajectoryOverviewSpans = (
  presentation: AgentTrajectoryPresentation,
  viewport: AgentTrajectoryTimeRange | null,
  limit: number,
): AgentTrajectoryOverviewSpan[] | null => {
  const scale = createTrajectoryTimeScale(presentation, viewport);
  if (!scale || !Number.isFinite(limit) || limit <= 0) {
    return null;
  }

  const spans: AgentTrajectoryOverviewSpan[] = [];
  for (const item of presentation.items) {
    if (!item.interval || !trajectoryRangesOverlap(item.interval, scale.viewport)) {
      continue;
    }
    if (spans.length >= limit) {
      return null;
    }
    spans.push({
      item,
      startRatio: scale.toRatio(item.interval.start),
      endRatio: scale.toRatio(item.interval.end),
    });
  }
  return spans;
};

export const zoomTrajectoryViewport = (
  domain: AgentTrajectoryTimeRange | null,
  viewport: AgentTrajectoryTimeRange | null,
  factor: number,
): AgentTrajectoryTimeRange | null => {
  const fullDomain = expandedTrajectoryDomain(domain);
  if (!fullDomain || !Number.isFinite(factor) || factor <= 0) {
    return fullDomain;
  }
  const requestedViewport = validTrajectoryRange(viewport);
  if (!requestedViewport) {
    return fullDomain;
  }
  const currentViewport = clampTrajectoryRangeToDomain(fullDomain, requestedViewport);
  const domainSpan = fullDomain.end - fullDomain.start;
  const currentSpan = currentViewport.end - currentViewport.start;
  const nextSpan = Math.min(domainSpan, currentSpan / factor);
  if (!Number.isFinite(nextSpan) || nextSpan <= 0) {
    return fullDomain;
  }

  const center = currentViewport.start + currentSpan / 2;
  let start = center - nextSpan / 2;
  let end = center + nextSpan / 2;
  if (start < fullDomain.start) {
    start = fullDomain.start;
    end = start + nextSpan;
  }
  if (end > fullDomain.end) {
    end = fullDomain.end;
    start = end - nextSpan;
  }
  return { start, end };
};
