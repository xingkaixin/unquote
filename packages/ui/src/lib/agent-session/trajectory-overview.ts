import type { AgentTrajectoryItemKind, AgentTrajectoryStatus } from "./types";
import type {
  AgentTrajectoryLane,
  AgentTrajectoryOverview,
  AgentTrajectoryOverviewBucket,
  AgentTrajectoryPresentation,
} from "./trajectory-presentation";
import { createTrajectoryTimeScale } from "./trajectory-time-scale";
import {
  clampTrajectoryRangeToDomain,
  finiteTrajectoryNumber,
  trajectoryRangesOverlap,
  type AgentTrajectoryTimeRange,
  validTrajectoryRange,
} from "./trajectory-time";

const MINIMUM_BUCKET_WIDTH_PX = 6;
const MAXIMUM_BUCKET_COUNT = 512;

interface MutableOverviewBucket {
  count: number;
  interval: AgentTrajectoryTimeRange | null;
  status: AgentTrajectoryStatus | null;
  kind: AgentTrajectoryItemKind | null;
  kindCount: number;
  kindCounts: Map<AgentTrajectoryItemKind, number> | null;
}

export const trajectoryOverviewBucketCount = (widthPx: number, timedItemCount: number) => {
  if (!Number.isFinite(timedItemCount) || timedItemCount <= 0) {
    return 0;
  }
  if (!Number.isFinite(widthPx) || widthPx <= 0) {
    return 1;
  }
  return Math.min(MAXIMUM_BUCKET_COUNT, Math.max(1, Math.floor(widthPx / MINIMUM_BUCKET_WIDTH_PX)));
};

const emptyBuckets = (bucketCount: number) => {
  const buckets: MutableOverviewBucket[] = [];
  for (let index = 0; index < bucketCount; index += 1) {
    buckets.push({
      count: 0,
      interval: null,
      status: null,
      kind: null,
      kindCount: 0,
      kindCounts: null,
    });
  }
  return buckets;
};

const statusPriority = (status: AgentTrajectoryStatus) => {
  if (status === "failed" || status === "aborted") {
    return 2;
  }
  return status === "running" ? 1 : 0;
};

const includeBucketFact = (
  bucket: MutableOverviewBucket,
  interval: AgentTrajectoryTimeRange,
  status: AgentTrajectoryStatus,
  kind?: AgentTrajectoryItemKind,
) => {
  bucket.count += 1;
  bucket.interval = bucket.interval
    ? {
        start: Math.min(bucket.interval.start, interval.start),
        end: Math.max(bucket.interval.end, interval.end),
      }
    : interval;
  if (!bucket.status || statusPriority(status) > statusPriority(bucket.status)) {
    bucket.status = status;
  }
  if (kind === undefined) {
    return;
  }
  bucket.kindCounts ??= new Map();
  const kindCount = (bucket.kindCounts.get(kind) ?? 0) + 1;
  bucket.kindCounts.set(kind, kindCount);
  if (kindCount > bucket.kindCount) {
    bucket.kindCount = kindCount;
    bucket.kind = kind;
  }
};

const bucketIndexFor = (time: number, viewport: AgentTrajectoryTimeRange, bucketCount: number) => {
  const span = viewport.end - viewport.start;
  if (span <= 0 || !Number.isFinite(span)) {
    return 0;
  }
  const ratio = (Math.min(viewport.end, Math.max(viewport.start, time)) - viewport.start) / span;
  return Math.min(bucketCount - 1, Math.max(0, Math.floor(ratio * bucketCount)));
};

const midpoint = (interval: AgentTrajectoryTimeRange) =>
  interval.start + (interval.end - interval.start) / 2;

const safeBucketCount = (bucketCount: number) =>
  Number.isFinite(bucketCount) && bucketCount > 0
    ? Math.min(MAXIMUM_BUCKET_COUNT, Math.floor(bucketCount))
    : 0;

export const createAgentTrajectoryOverview = (
  presentation: AgentTrajectoryPresentation,
  viewport: AgentTrajectoryTimeRange | null,
  bucketCount: number,
): AgentTrajectoryOverview => {
  const domain = validTrajectoryRange(presentation.timeDomain);
  const count = safeBucketCount(bucketCount);
  if (!domain || count === 0) {
    return {
      viewport: null,
      bucketCount: 0,
      lanes: { activity: [], model: [], tool: [] },
      turnBoundaries: [],
    };
  }

  const activeViewport = clampTrajectoryRangeToDomain(domain, viewport);
  const scale = createTrajectoryTimeScale(presentation, activeViewport);
  const lanes: Record<AgentTrajectoryLane, MutableOverviewBucket[]> = {
    activity: emptyBuckets(count),
    model: emptyBuckets(count),
    tool: emptyBuckets(count),
  };
  const turnBoundaries = emptyBuckets(count);
  const bucketIndex = (time: number) =>
    scale
      ? Math.min(count - 1, Math.max(0, Math.floor(scale.toRatio(time) * count)))
      : bucketIndexFor(time, activeViewport, count);

  for (const item of presentation.items) {
    if (!item.interval || !trajectoryRangesOverlap(item.interval, activeViewport)) {
      continue;
    }
    const index = bucketIndex(midpoint(item.interval));
    includeBucketFact(lanes[item.lane][index]!, item.interval, item.item.status, item.item.kind);
  }

  for (const turn of presentation.groups) {
    const status = turn.turn?.status;
    if (!status) {
      continue;
    }
    for (const time of [turn.turn?.startedAt, turn.turn?.endedAt]) {
      const point = finiteTrajectoryNumber(time);
      if (point === undefined || point < activeViewport.start || point > activeViewport.end) {
        continue;
      }
      const index = bucketIndex(point);
      includeBucketFact(turnBoundaries[index]!, { start: point, end: point }, status);
    }
  }

  return {
    viewport: activeViewport,
    bucketCount: count,
    lanes: {
      activity: finalizeBuckets(lanes.activity),
      model: finalizeBuckets(lanes.model),
      tool: finalizeBuckets(lanes.tool),
    },
    turnBoundaries: finalizeBuckets(turnBoundaries),
  };
};

const finalizeBuckets = (
  buckets: readonly MutableOverviewBucket[],
): AgentTrajectoryOverviewBucket[] =>
  buckets.map(({ count, interval, status, kind }) => ({ count, interval, status, kind }));
