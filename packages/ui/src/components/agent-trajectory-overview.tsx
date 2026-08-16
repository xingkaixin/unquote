import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "../i18n/context";
import type { AgentTrajectoryStatus } from "../lib/agent-session";
import {
  createAgentTrajectoryOverview,
  trajectoryOverviewBucketCount,
  zoomTrajectoryViewport,
  type AgentTrajectoryLane,
  type AgentTrajectoryOverviewBucket,
  type AgentTrajectoryPresentation,
  type AgentTrajectoryTimeRange,
} from "../lib/agent-session/trajectory-presentation";
import { formatClockTime } from "../lib/format";
import { formatTimestamp } from "./agent-session-format";
import { formatTrajectoryDuration } from "./agent-trajectory-format";
import { Button } from "./button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

const ZOOM_FACTOR = 2;
const SVG_HEIGHT = 3;
const BUCKET_SEGMENT_INSET = 0.15;
const RANGE_KEYBOARD_INCREMENT_COUNT = 100;

const lanes: readonly AgentTrajectoryLane[] = ["activity", "model", "tool"];
const tones = ["completed", "running", "critical"] as const;

type TrajectoryTone = (typeof tones)[number];

const laneLabelKey: Record<
  AgentTrajectoryLane,
  "trajectory.lane.activity" | "trajectory.lane.model" | "trajectory.lane.tool"
> = {
  activity: "trajectory.lane.activity",
  model: "trajectory.lane.model",
  tool: "trajectory.lane.tool",
};

const lanePosition: Record<AgentTrajectoryLane, number> = {
  activity: 0.5,
  model: 1.5,
  tool: 2.5,
};

const toneStrokeClass: Record<TrajectoryTone, string> = {
  completed: "stroke-success",
  running: "stroke-warning",
  critical: "stroke-error",
};

const finiteRange = (range: AgentTrajectoryTimeRange | null) => {
  if (
    !range ||
    !Number.isFinite(range.start) ||
    !Number.isFinite(range.end) ||
    range.start > range.end
  ) {
    return null;
  }
  return range;
};

const nextRepresentable = (value: number) => {
  if (!Number.isFinite(value)) {
    return value;
  }
  if (value === 0) {
    return Number.MIN_VALUE;
  }
  const view = new DataView(new ArrayBuffer(Float64Array.BYTES_PER_ELEMENT));
  view.setFloat64(0, value, false);
  const bits = view.getBigUint64(0, false);
  // Adjacent Float64 values move through bit patterns in opposite directions around zero.
  view.setBigUint64(0, value > 0 ? bits + 1n : bits - 1n, false);
  return view.getFloat64(0, false);
};

const previousRepresentable = (value: number) => -nextRepresentable(-value);

const finiteDomainSpan = (domain: AgentTrajectoryTimeRange) => {
  const span = domain.end - domain.start;
  return Number.isFinite(span) && span >= 0 ? span : null;
};

const rangeCoordinateMax = (domain: AgentTrajectoryTimeRange) => finiteDomainSpan(domain) ?? 1;

const usableStepWithin = (candidate: number, span: number) =>
  Number.isFinite(candidate) && candidate > 0 && candidate <= span ? candidate : 0;

const rangeStepFor = (domain: AgentTrajectoryTimeRange | null) => {
  if (!domain) {
    return 1;
  }
  const span = finiteDomainSpan(domain);
  if (span === null) {
    return 1 / RANGE_KEYBOARD_INCREMENT_COUNT;
  }
  if (span === 0) {
    return 1;
  }
  const startResolution = usableStepWithin(nextRepresentable(domain.start) - domain.start, span);
  const endResolution = usableStepWithin(domain.end - previousRepresentable(domain.end), span);
  const candidate = Math.max(span / RANGE_KEYBOARD_INCREMENT_COUNT, startResolution, endResolution);
  return candidate > 0 && Number.isFinite(candidate) ? Math.min(candidate, span) : span;
};

const clampCoordinate = (value: number, maximum: number) => Math.min(maximum, Math.max(0, value));

const coordinateForRangeValue = (value: number, domain: AgentTrajectoryTimeRange) => {
  if (value <= domain.start) {
    return 0;
  }
  const maximum = rangeCoordinateMax(domain);
  if (value >= domain.end) {
    return maximum;
  }
  const span = finiteDomainSpan(domain);
  if (span !== null) {
    return clampCoordinate(value - domain.start, span);
  }
  const scale = Math.max(Math.abs(domain.start), Math.abs(domain.end));
  const scaledStart = domain.start / scale;
  const scaledSpan = domain.end / scale - scaledStart;
  const coordinate = (value / scale - scaledStart) / scaledSpan;
  return Number.isFinite(coordinate) ? clampCoordinate(coordinate, 1) : 0;
};

const rangeValueForCoordinate = (coordinate: number, domain: AgentTrajectoryTimeRange) => {
  const maximum = rangeCoordinateMax(domain);
  const clamped = clampCoordinate(coordinate, maximum);
  if (clamped === 0) {
    return domain.start;
  }
  if (clamped === maximum) {
    return domain.end;
  }
  const span = finiteDomainSpan(domain);
  if (span !== null) {
    return domain.start + clamped;
  }
  return domain.start * (1 - clamped) + domain.end * clamped;
};

const snapRangeCoordinate = (value: number, maximum: number, step: number) => {
  const clamped = clampCoordinate(value, maximum);
  if (clamped === 0 || clamped === maximum) {
    return clamped;
  }
  return clampCoordinate(Math.round(clamped / step) * step, maximum);
};

const rangeValueFromInput = (
  value: string,
  currentValue: number,
  domain: AgentTrajectoryTimeRange,
) => {
  const coordinate = Number(value);
  if (!Number.isFinite(coordinate)) {
    return null;
  }
  const maximum = rangeCoordinateMax(domain);
  const snapped = snapRangeCoordinate(coordinate, maximum, rangeStepFor(domain));
  const currentCoordinate = coordinateForRangeValue(currentValue, domain);
  const candidate = rangeValueForCoordinate(snapped, domain);
  if (snapped > currentCoordinate && candidate <= currentValue) {
    const next = nextRepresentable(currentValue);
    return next <= domain.end ? next : currentValue;
  }
  if (snapped < currentCoordinate && candidate >= currentValue) {
    const previous = previousRepresentable(currentValue);
    return previous >= domain.start ? previous : currentValue;
  }
  return Math.min(domain.end, Math.max(domain.start, candidate));
};

const fractionalSecondDigitsFor = (domain: AgentTrajectoryTimeRange) => {
  const span = domain.end - domain.start;
  if (!Number.isFinite(span) || span >= 100_000) {
    return 0;
  }
  if (span >= 10_000) {
    return 1;
  }
  if (span >= 1_000) {
    return 2;
  }
  return 3;
};

const formatPreciseTimestamp = (
  value: number,
  locale: "en" | "zh-CN",
  fractionalSecondDigits: 0 | 1 | 2 | 3,
) => {
  if (fractionalSecondDigits === 0) {
    return formatTimestamp(value, undefined, locale);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits,
  }).format(date);
};

const formatSubMillisecondOffset = (offset: number, locale: "en" | "zh-CN") =>
  new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "millisecond",
    unitDisplay: "short",
    signDisplay: "always",
    notation: offset !== 0 && Math.abs(offset) < 0.001 ? "scientific" : "standard",
    maximumSignificantDigits: 15,
  }).format(offset);

const formatRangeValue = (
  value: number,
  domain: AgentTrajectoryTimeRange,
  locale: "en" | "zh-CN",
) => {
  const wholeMilliseconds = Math.trunc(value);
  const timestamp = formatPreciseTimestamp(
    wholeMilliseconds,
    locale,
    fractionalSecondDigitsFor(domain),
  );
  const readable =
    timestamp ||
    new Intl.NumberFormat(locale, {
      notation: "scientific",
      maximumSignificantDigits: 17,
    }).format(value);
  const fractionalMilliseconds = value - wholeMilliseconds;
  return fractionalMilliseconds !== 0
    ? `${readable} · ${formatSubMillisecondOffset(fractionalMilliseconds, locale)}`
    : readable;
};

// Beyond this offset a duration in minutes prints hundreds of digits, so
// switch to scientific milliseconds. Also past the valid Date range.
const HUGE_TICK_OFFSET_MS = 1e15;

const tickTimeLabel = (value: number, locale: "en" | "zh-CN") => {
  if (Number.isNaN(new Date(value).getTime())) {
    return new Intl.NumberFormat(locale, {
      notation: "scientific",
      maximumSignificantDigits: 6,
    }).format(value);
  }
  return formatClockTime(value, locale);
};

const tickOffsetLabel = (offsetMs: number, locale: "en" | "zh-CN") => {
  if (!Number.isFinite(offsetMs) || offsetMs > HUGE_TICK_OFFSET_MS) {
    return `+${new Intl.NumberFormat(locale, {
      style: "unit",
      unit: "millisecond",
      unitDisplay: "short",
      notation: "scientific",
      maximumSignificantDigits: 4,
    }).format(offsetMs)}`;
  }
  return `+${formatTrajectoryDuration(offsetMs, locale)}`;
};

const clampToRange = (range: AgentTrajectoryTimeRange | null, bounds: AgentTrajectoryTimeRange) => {
  const candidate = finiteRange(range);
  if (!candidate) {
    return bounds;
  }
  const start = Math.min(bounds.end, Math.max(bounds.start, candidate.start));
  const end = Math.min(bounds.end, Math.max(bounds.start, candidate.end));
  return start <= end ? { start, end } : { start: end, end: start };
};

const toneForStatus = (status: AgentTrajectoryStatus | null): TrajectoryTone | null => {
  if (status === "failed" || status === "aborted") {
    return "critical";
  }
  if (status === "running") {
    return "running";
  }
  return status === "completed" ? "completed" : null;
};

// Ascending stroke widths so denser buckets read as heavier marks.
const DENSITY_STROKE_WIDTHS = [0.08, 0.14, 0.22] as const;

const densityTier = (count: number, maxCount: number) => {
  const ratio = maxCount > 0 ? count / maxCount : 0;
  return ratio > 2 / 3 ? 2 : ratio > 1 / 3 ? 1 : 0;
};

const laneMaxCount = (buckets: readonly AgentTrajectoryOverviewBucket[]) => {
  let max = 0;
  for (const bucket of buckets) {
    if (bucket.count > max) {
      max = bucket.count;
    }
  }
  return max;
};

const lanePath = (
  buckets: readonly AgentTrajectoryOverviewBucket[],
  lane: AgentTrajectoryLane,
  tone: TrajectoryTone,
  tier: number,
  maxCount: number,
) => {
  const y = lanePosition[lane];
  let d = "";
  for (let index = 0; index < buckets.length; index += 1) {
    const bucket = buckets[index]!;
    if (toneForStatus(bucket.status) !== tone || densityTier(bucket.count, maxCount) !== tier) {
      continue;
    }
    d += `M${index + BUCKET_SEGMENT_INSET} ${y}H${index + 1 - BUCKET_SEGMENT_INSET}`;
  }
  return d;
};

const turnBoundaryPath = (buckets: readonly AgentTrajectoryOverviewBucket[]) => {
  let d = "";
  for (let index = 0; index < buckets.length; index += 1) {
    if (buckets[index]!.count > 0) {
      d += `M${index + 0.5} 0V${SVG_HEIGHT}`;
    }
  }
  return d;
};

export interface AgentTrajectoryOverviewProps {
  presentation: AgentTrajectoryPresentation;
  timeRange: AgentTrajectoryTimeRange | null;
  onTimeRangeChange: (range: AgentTrajectoryTimeRange | null) => void;
  className?: string;
}

export const AgentTrajectoryOverview = ({
  presentation,
  timeRange,
  onTimeRangeChange,
  className,
}: AgentTrajectoryOverviewProps) => {
  const { locale, t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const [zoomViewport, setZoomViewport] = useState<AgentTrajectoryTimeRange | null>(null);
  const domain = finiteRange(presentation.timeDomain);
  const timeFactCount = domain ? Math.max(1, presentation.timedItemCount) : 0;
  const activeViewport = useMemo(
    () => zoomTrajectoryViewport(domain, zoomViewport, 1),
    [domain?.end, domain?.start, zoomViewport?.end, zoomViewport?.start],
  );
  const bucketCount = useMemo(
    () =>
      measuredWidth === null ? 0 : trajectoryOverviewBucketCount(measuredWidth, timeFactCount),
    [measuredWidth, timeFactCount],
  );
  const overview = useMemo(
    () => createAgentTrajectoryOverview(presentation, activeViewport, bucketCount),
    [activeViewport, bucketCount, presentation],
  );

  useEffect(() => {
    setZoomViewport(finiteRange(presentation.timeDomain));
  }, [presentation]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }
    if (typeof ResizeObserver === "undefined") {
      setMeasuredWidth(element.getBoundingClientRect().width);
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      const nextWidth = typeof width === "number" && Number.isFinite(width) ? width : 0;
      setMeasuredWidth((current) => (current === nextWidth ? current : nextWidth));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [domain?.end, domain?.start]);

  const selectedRange = domain ? clampToRange(timeRange, domain) : null;
  const selectionRect = (() => {
    if (!activeViewport || !timeRange || overview.bucketCount === 0) {
      return null;
    }
    const span = activeViewport.end - activeViewport.start;
    if (!Number.isFinite(span) || span <= 0) {
      return null;
    }
    if (timeRange.end < activeViewport.start || timeRange.start > activeViewport.end) {
      return null;
    }
    const clamped = clampToRange(timeRange, activeViewport);
    const x = ((clamped.start - activeViewport.start) / span) * overview.bucketCount;
    const width = Math.max(0.05, ((clamped.end - clamped.start) / span) * overview.bucketCount);
    return { x, width };
  })();
  // Left tick anchors the viewport in absolute time; the middle and right
  // ticks read as offsets so zooming stays legible without repeating dates.
  const tickLabels = activeViewport
    ? [
        tickTimeLabel(Math.trunc(activeViewport.start), locale),
        tickOffsetLabel((activeViewport.end - activeViewport.start) / 2, locale),
        tickOffsetLabel(activeViewport.end - activeViewport.start, locale),
      ]
    : [];
  const controlsDisabled = !domain;
  const inputMin = 0;
  const inputMax = domain ? rangeCoordinateMax(domain) : 0;
  const inputStart =
    domain && selectedRange ? coordinateForRangeValue(selectedRange.start, domain) : 0;
  const inputEnd = domain && selectedRange ? coordinateForRangeValue(selectedRange.end, domain) : 0;
  const inputStep = rangeStepFor(domain);
  const rangeStartText =
    domain && selectedRange ? formatRangeValue(selectedRange.start, domain, locale) : "";
  const rangeEndText =
    domain && selectedRange ? formatRangeValue(selectedRange.end, domain, locale) : "";

  const changeStart = (value: string) => {
    if (!domain || !selectedRange) {
      return;
    }
    const next = rangeValueFromInput(value, selectedRange.start, domain);
    if (next === null) {
      return;
    }
    const start = Math.min(selectedRange.end, Math.max(domain.start, next));
    onTimeRangeChange({ start, end: selectedRange.end });
  };

  const changeEnd = (value: string) => {
    if (!domain || !selectedRange) {
      return;
    }
    const next = rangeValueFromInput(value, selectedRange.end, domain);
    if (next === null) {
      return;
    }
    const end = Math.max(selectedRange.start, Math.min(domain.end, next));
    onTimeRangeChange({ start: selectedRange.start, end });
  };

  const zoom = (factor: number) => {
    if (!domain) {
      return;
    }
    setZoomViewport((current) => zoomTrajectoryViewport(domain, current, factor));
  };

  const reset = () => {
    if (!domain) {
      return;
    }
    setZoomViewport(domain);
    onTimeRangeChange(null);
  };

  return (
    <section
      aria-label={t("trajectory.overview")}
      data-trajectory-overview
      data-bucket-count={overview.bucketCount}
      data-viewport-start={activeViewport?.start}
      data-viewport-end={activeViewport?.end}
      className={`flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-surface-100 p-3 ${className ?? ""}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="uq-label m-0">{t("trajectory.overview")}</h2>
        <div className="flex items-center gap-1" aria-label={t("trajectory.overview")}>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="size-7 shrink-0 p-0"
                  aria-label={t("trajectory.zoomIn")}
                  disabled={controlsDisabled}
                  onClick={() => zoom(ZOOM_FACTOR)}
                >
                  <ZoomIn className="size-3.5" aria-hidden="true" />
                </Button>
              }
            />
            <TooltipContent>{t("trajectory.zoomIn")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="size-7 shrink-0 p-0"
                  aria-label={t("trajectory.zoomOut")}
                  disabled={controlsDisabled}
                  onClick={() => zoom(1 / ZOOM_FACTOR)}
                >
                  <ZoomOut className="size-3.5" aria-hidden="true" />
                </Button>
              }
            />
            <TooltipContent>{t("trajectory.zoomOut")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="size-7 shrink-0 p-0"
                  aria-label={t("trajectory.reset")}
                  disabled={controlsDisabled}
                  onClick={reset}
                >
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                </Button>
              }
            />
            <TooltipContent>{t("trajectory.reset")}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1 text-[11px] text-text-secondary">
          <span className="shrink-0">{t("trajectory.rangeStart")}</span>
          <output
            aria-hidden="true"
            className="min-w-0 truncate text-right font-mono text-[10px] text-text-tertiary"
            title={rangeStartText}
          >
            {rangeStartText}
          </output>
          <input
            type="range"
            min={inputMin}
            max={inputMax}
            step={inputStep}
            value={inputStart}
            disabled={controlsDisabled}
            aria-label={t("trajectory.rangeStart")}
            aria-valuetext={rangeStartText || undefined}
            onChange={(event) => changeStart(event.currentTarget.value)}
            className="col-span-2 min-w-0 accent-accent disabled:opacity-40"
          />
        </div>
        <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1 text-[11px] text-text-secondary">
          <span className="shrink-0">{t("trajectory.rangeEnd")}</span>
          <output
            aria-hidden="true"
            className="min-w-0 truncate text-right font-mono text-[10px] text-text-tertiary"
            title={rangeEndText}
          >
            {rangeEndText}
          </output>
          <input
            type="range"
            min={inputMin}
            max={inputMax}
            step={inputStep}
            value={inputEnd}
            disabled={controlsDisabled}
            aria-label={t("trajectory.rangeEnd")}
            aria-valuetext={rangeEndText || undefined}
            onChange={(event) => changeEnd(event.currentTarget.value)}
            className="col-span-2 min-w-0 accent-accent disabled:opacity-40"
          />
        </div>
      </div>

      {activeViewport ? (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-text-secondary">
            <span className="inline-flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
              {t("trajectory.status.completed")}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-warning" aria-hidden="true" />
              {t("trajectory.status.running")}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-error" aria-hidden="true" />
              {t("trajectory.status.failed")} / {t("trajectory.status.aborted")}
            </span>
          </div>
          <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-2">
            <div className="grid grid-rows-3 gap-1 py-0.5 text-right font-mono text-[10px] text-text-tertiary">
              {lanes.map((lane) => (
                <span key={lane}>{t(laneLabelKey[lane])}</span>
              ))}
            </div>
            <div ref={containerRef} className="min-w-0">
              <svg
                aria-hidden="true"
                focusable="false"
                data-trajectory-chart
                viewBox={`0 0 ${Math.max(overview.bucketCount, 1)} ${SVG_HEIGHT}`}
                preserveAspectRatio="none"
                className="block h-16 w-full overflow-visible"
              >
                <path
                  data-trajectory-turn-boundary
                  d={turnBoundaryPath(overview.turnBoundaries)}
                  fill="none"
                  strokeWidth="0.04"
                  className="stroke-border-medium"
                />
                {lanes.map((lane) => (
                  <line
                    key={lane}
                    x1="0"
                    x2={Math.max(overview.bucketCount, 1)}
                    y1={lanePosition[lane]}
                    y2={lanePosition[lane]}
                    strokeWidth="0.04"
                    className="stroke-border"
                  />
                ))}
                {lanes.flatMap((lane) => {
                  const maxCount = laneMaxCount(overview.lanes[lane]);
                  return tones.flatMap((tone) =>
                    DENSITY_STROKE_WIDTHS.map((strokeWidth, tier) => (
                      <path
                        key={`${lane}-${tone}-${tier}`}
                        data-trajectory-tone={`${lane}-${tone}`}
                        data-trajectory-density={tier}
                        d={lanePath(overview.lanes[lane], lane, tone, tier, maxCount)}
                        fill="none"
                        strokeWidth={strokeWidth}
                        strokeLinecap="round"
                        vectorEffect="non-scaling-stroke"
                        className={toneStrokeClass[tone]}
                      />
                    )),
                  );
                })}
                {selectionRect ? (
                  <rect
                    data-trajectory-selection
                    x={selectionRect.x}
                    y="0"
                    width={selectionRect.width}
                    height={SVG_HEIGHT}
                    className="fill-accent opacity-20"
                  />
                ) : null}
              </svg>
              <div
                data-trajectory-ticks
                aria-hidden="true"
                className="flex justify-between pt-1 font-mono text-[9px] text-text-tertiary"
              >
                {tickLabels.map((label, index) => (
                  <span
                    key={index}
                    className={index === 1 ? "text-center" : index === 2 ? "text-right" : ""}
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </>
      ) : (
        <p className="m-0 text-[11px] text-text-tertiary">{t("trajectory.noTimeline")}</p>
      )}
    </section>
  );
};
