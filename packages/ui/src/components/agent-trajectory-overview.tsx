import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "../i18n/context";
import type { AgentTrajectoryItemKind } from "../lib/agent-session";
import {
  createAgentTrajectoryOverview,
  trajectoryOverviewBucketCount,
  type AgentTrajectoryOverviewBucket,
} from "../lib/agent-session/trajectory-overview";
import type {
  AgentTrajectoryLane,
  AgentTrajectoryPresentation,
  AgentTrajectoryTimeRange,
} from "../lib/agent-session/trajectory-presentation";
import { agentTrajectoryLaneFor } from "../lib/agent-session/trajectory-presentation";
import {
  createTrajectoryTimeScale,
  trajectoryOverviewSpans,
  zoomTrajectoryViewport,
} from "../lib/agent-session/trajectory-time-scale";
import {
  clampTrajectoryRange,
  coordinateForTrajectoryRangeValue,
  finiteTrajectoryRange,
  formatTrajectoryRangeValue,
  rangeCoordinateMax,
  trajectoryRangeStep,
  trajectoryRangeValueFromInput,
  trajectoryTickOffsetLabel,
  trajectoryTickTimeLabel,
} from "./agent-trajectory-overview-range";
import { formatTrajectoryDuration, trajectoryKindMessageKey } from "./agent-trajectory-format";
import { Button } from "./button";
import { RangeSlider } from "./range-slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

const ZOOM_FACTOR = 2;
const SVG_HEIGHT = 3;
const BUCKET_SEGMENT_INSET = 0.15;
// Above this many visible items the chart falls back to aggregated buckets so
// the DOM stays bounded for large sessions. Typical sessions run a few hundred
// items, so they get per-event spans; the trajectory DOM budget in
// docs/performance.md derives from this cap.
export const trajectoryOverviewSpanLimit = 1000;

type ChartColorKey = AgentTrajectoryItemKind | "error";

interface ChartVisualDefinition {
  strokeClass: string;
  fillClass: string;
}

const laneDefinitions = {
  activity: { labelKey: "trajectory.lane.activity", position: 0.5 },
  model: { labelKey: "trajectory.lane.model", position: 1.5 },
  tool: { labelKey: "trajectory.lane.tool", position: 2.5 },
} satisfies Record<
  AgentTrajectoryLane,
  {
    labelKey: "trajectory.lane.activity" | "trajectory.lane.model" | "trajectory.lane.tool";
    position: number;
  }
>;

const itemChartDefinitions = {
  user: {
    strokeClass: "stroke-code-boolean",
    fillClass: "bg-code-boolean",
  },
  system: {
    strokeClass: "stroke-text-tertiary",
    fillClass: "bg-text-tertiary",
  },
  assistant: {
    strokeClass: "stroke-code-string",
    fillClass: "bg-code-string",
  },
  reasoning: {
    strokeClass: "stroke-code-number",
    fillClass: "bg-code-number",
  },
  tool: { strokeClass: "stroke-accent", fillClass: "bg-accent" },
  subagent: { strokeClass: "stroke-code-key", fillClass: "bg-code-key" },
  compaction: {
    strokeClass: "stroke-code-null",
    fillClass: "bg-code-null",
  },
} satisfies Record<AgentTrajectoryItemKind, ChartVisualDefinition>;

const chartDefinitions = {
  ...itemChartDefinitions,
  error: { strokeClass: "stroke-error", fillClass: "bg-error" },
} satisfies Record<ChartColorKey, ChartVisualDefinition>;

const laneEntries = Object.entries(laneDefinitions) as [
  AgentTrajectoryLane,
  (typeof laneDefinitions)[AgentTrajectoryLane],
][];
const itemChartEntries = Object.entries(itemChartDefinitions) as [
  AgentTrajectoryItemKind,
  ChartVisualDefinition,
][];
const chartEntries = Object.entries(chartDefinitions) as [ChartColorKey, ChartVisualDefinition][];

const colorKeysForLane = (lane: AgentTrajectoryLane): readonly ChartColorKey[] => {
  const keys: ChartColorKey[] = [];
  for (const [key] of itemChartEntries) {
    if (agentTrajectoryLaneFor(key) === lane) {
      keys.push(key);
    }
  }
  keys.push("error");
  return keys;
};

const isFailureStatus = (status: AgentTrajectoryOverviewBucket["status"]) =>
  status === "failed" || status === "aborted";

const bucketColorKey = (bucket: AgentTrajectoryOverviewBucket): ChartColorKey | null => {
  if (isFailureStatus(bucket.status)) {
    return "error";
  }
  return bucket.kind;
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
  position: number,
  colorKey: ChartColorKey,
  tier: number,
  maxCount: number,
) => {
  let d = "";
  for (let index = 0; index < buckets.length; index += 1) {
    const bucket = buckets[index]!;
    if (bucketColorKey(bucket) !== colorKey || densityTier(bucket.count, maxCount) !== tier) {
      continue;
    }
    d += `M${index + BUCKET_SEGMENT_INSET} ${position}H${index + 1 - BUCKET_SEGMENT_INSET}`;
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
  selectedItemId?: string | undefined;
  onSelectItem?: (itemId: string) => void;
  className?: string;
}

export const AgentTrajectoryOverview = ({
  presentation,
  timeRange,
  onTimeRangeChange,
  selectedItemId,
  onSelectItem,
  className,
}: AgentTrajectoryOverviewProps) => {
  const { locale, t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const domain = finiteTrajectoryRange(presentation.timeDomain);
  const timeFactCount = domain ? Math.max(1, presentation.timedItemCount) : 0;
  // The selected time range IS the viewport: narrowing the range zooms the
  // chart into it while the same range filters the ledger below.
  const activeViewport = useMemo(
    () => zoomTrajectoryViewport(domain, timeRange ?? domain, 1),
    [domain?.end, domain?.start, timeRange?.end, timeRange?.start],
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

  const selectedRange = domain ? clampTrajectoryRange(timeRange, domain) : null;
  const timeScale = useMemo(
    () => createTrajectoryTimeScale(presentation, activeViewport),
    [activeViewport?.end, activeViewport?.start, presentation],
  );
  const spans = useMemo(
    () => trajectoryOverviewSpans(presentation, activeViewport, trajectoryOverviewSpanLimit),
    [activeViewport?.end, activeViewport?.start, presentation],
  );
  // Left tick anchors the viewport in absolute time; the middle and right
  // ticks read as offsets so zooming stays legible without repeating dates.
  // The middle tick follows the compressed axis so it lands mid-chart.
  const tickLabels = activeViewport
    ? [
        trajectoryTickTimeLabel(Math.trunc(activeViewport.start), locale),
        trajectoryTickOffsetLabel(
          timeScale
            ? timeScale.fromRatio(0.5) - activeViewport.start
            : (activeViewport.end - activeViewport.start) / 2,
          locale,
        ),
        trajectoryTickOffsetLabel(activeViewport.end - activeViewport.start, locale),
      ]
    : [];
  const controlsDisabled = !domain;
  const inputMin = 0;
  const inputMax = domain ? rangeCoordinateMax(domain) : 0;
  const inputStart =
    domain && selectedRange ? coordinateForTrajectoryRangeValue(selectedRange.start, domain) : 0;
  const inputEnd =
    domain && selectedRange ? coordinateForTrajectoryRangeValue(selectedRange.end, domain) : 0;
  const inputStep = trajectoryRangeStep(domain);
  const rangeStartText =
    domain && selectedRange ? formatTrajectoryRangeValue(selectedRange.start, domain, locale) : "";
  const rangeEndText =
    domain && selectedRange ? formatTrajectoryRangeValue(selectedRange.end, domain, locale) : "";

  const changeRange = (next: readonly number[]) => {
    if (!domain || !selectedRange || next.length !== 2) {
      return;
    }
    // Only convert the thumb that moved: coordinate round-trips can drift on
    // extreme domains and would shift the untouched end of the range.
    const nextStart =
      next[0] === inputStart
        ? selectedRange.start
        : trajectoryRangeValueFromInput(String(next[0]), selectedRange.start, domain);
    const nextEnd =
      next[1] === inputEnd
        ? selectedRange.end
        : trajectoryRangeValueFromInput(String(next[1]), selectedRange.end, domain);
    if (nextStart === null || nextEnd === null) {
      return;
    }
    // Whole milliseconds read naturally on ordinary domains; sub-millisecond
    // domains keep the fractional precision they need.
    const quantize = (value: number) =>
      domain.end - domain.start >= 1_000 ? Math.round(value) : value;
    const boundedStart = Math.min(domain.end, Math.max(domain.start, quantize(nextStart)));
    const boundedEnd = Math.min(domain.end, Math.max(domain.start, quantize(nextEnd)));
    onTimeRangeChange({
      start: Math.min(boundedStart, boundedEnd),
      end: Math.max(boundedStart, boundedEnd),
    });
  };

  const zoom = (factor: number) => {
    if (!domain) {
      return;
    }
    const next = zoomTrajectoryViewport(domain, timeRange ?? domain, factor);
    if (!next || (next.start === domain.start && next.end === domain.end)) {
      onTimeRangeChange(null);
      return;
    }
    onTimeRangeChange(next);
  };

  const reset = () => {
    if (!domain) {
      return;
    }
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

      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-baseline justify-between gap-3 text-[11px] text-text-secondary">
          <span className="inline-flex min-w-0 items-baseline gap-2">
            <span className="shrink-0">{t("trajectory.rangeStart")}</span>
            <output
              aria-hidden="true"
              className="min-w-0 truncate font-mono text-[10px] text-text-tertiary"
              title={rangeStartText}
            >
              {rangeStartText}
            </output>
          </span>
          <span className="inline-flex min-w-0 items-baseline gap-2">
            <output
              aria-hidden="true"
              className="min-w-0 truncate text-right font-mono text-[10px] text-text-tertiary"
              title={rangeEndText}
            >
              {rangeEndText}
            </output>
            <span className="shrink-0">{t("trajectory.rangeEnd")}</span>
          </span>
        </div>
        <RangeSlider
          value={[inputStart, inputEnd]}
          min={inputMin}
          max={inputMax > inputMin ? inputMax : inputMin + 1}
          step={inputStep}
          disabled={controlsDisabled}
          onValueChange={changeRange}
          getAriaLabel={(index) =>
            index === 0 ? t("trajectory.rangeStart") : t("trajectory.rangeEnd")
          }
          getAriaValueText={(index) => (index === 0 ? rangeStartText : rangeEndText)}
        />
      </div>

      {activeViewport ? (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-text-secondary">
            {chartEntries.map(([key, definition]) => (
              <span key={key} className="inline-flex items-center gap-1">
                <span
                  className={`size-1.5 rounded-full ${definition.fillClass}`}
                  aria-hidden="true"
                />
                {key === "error"
                  ? `${t("trajectory.status.failed")} / ${t("trajectory.status.aborted")}`
                  : t(trajectoryKindMessageKey[key])}
              </span>
            ))}
          </div>
          <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-2">
            <div className="grid grid-rows-3 gap-1 py-0.5 text-right font-mono text-[10px] text-text-tertiary">
              {laneEntries.map(([lane, definition]) => (
                <span key={lane}>{t(definition.labelKey)}</span>
              ))}
            </div>
            <div ref={containerRef} className="min-w-0">
              <div className="relative">
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
                  {laneEntries.map(([lane, definition]) => (
                    <line
                      key={lane}
                      x1="0"
                      x2={Math.max(overview.bucketCount, 1)}
                      y1={definition.position}
                      y2={definition.position}
                      strokeWidth="0.04"
                      className="stroke-border"
                    />
                  ))}
                  {spans === null
                    ? laneEntries.flatMap(([lane, definition]) => {
                        const maxCount = laneMaxCount(overview.lanes[lane]);
                        return colorKeysForLane(lane).flatMap((colorKey) =>
                          DENSITY_STROKE_WIDTHS.map((strokeWidth, tier) => (
                            <path
                              key={`${lane}-${colorKey}-${tier}`}
                              data-trajectory-kind={`${lane}-${colorKey}`}
                              data-trajectory-density={tier}
                              d={lanePath(
                                overview.lanes[lane],
                                definition.position,
                                colorKey,
                                tier,
                                maxCount,
                              )}
                              fill="none"
                              strokeWidth={strokeWidth}
                              strokeLinecap="round"
                              vectorEffect="non-scaling-stroke"
                              className={chartDefinitions[colorKey].strokeClass}
                            />
                          )),
                        );
                      })
                    : null}
                </svg>
                {timeScale && timeScale.gaps.length > 0 ? (
                  <div aria-hidden="true" className="pointer-events-none absolute inset-0">
                    {timeScale.gaps.map((gap, index) => {
                      const left = timeScale.toRatio(gap.start) * 100;
                      const width = timeScale.toRatio(gap.end) * 100 - left;
                      return (
                        <div
                          key={index}
                          data-trajectory-gap={index}
                          title={t("trajectory.idleGap", {
                            duration: formatTrajectoryDuration(gap.end - gap.start, locale),
                          })}
                          className="pointer-events-auto absolute inset-y-0 flex items-center justify-center border-x border-dashed border-border-medium bg-surface-50"
                          style={{ left: `${left}%`, width: `${width}%` }}
                        >
                          <span
                            className="font-mono text-[9px] whitespace-nowrap text-text-tertiary"
                            style={{ writingMode: "vertical-rl" }}
                          >
                            {t("trajectory.idleGap", {
                              duration: formatTrajectoryDuration(gap.end - gap.start, locale),
                            })}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                {spans !== null && spans.length > 0 ? (
                  <div data-trajectory-spans className="absolute inset-0">
                    {spans.map((span) => {
                      const item = span.item;
                      const failed = isFailureStatus(item.item.status);
                      const colorKey: ChartColorKey = failed ? "error" : item.item.kind;
                      const selected = item.item.id === selectedItemId;
                      const label = `#${item.ordinal + 1} ${t(trajectoryKindMessageKey[item.item.kind])}: ${
                        item.summary || t(trajectoryKindMessageKey[item.item.kind])
                      }`;
                      return (
                        <button
                          key={item.ordinal}
                          type="button"
                          data-trajectory-span={item.ordinal}
                          aria-label={label}
                          aria-current={selected ? "true" : undefined}
                          title={label}
                          onClick={onSelectItem ? () => onSelectItem(item.item.id) : undefined}
                          className={`absolute h-2 -translate-y-1/2 rounded-[2px] ${chartDefinitions[colorKey].fillClass} ${
                            selected
                              ? "outline outline-2 outline-offset-1 outline-accent"
                              : "hover:outline hover:outline-1 hover:outline-border-medium"
                          }`}
                          style={{
                            left: `${span.startRatio * 100}%`,
                            width: `max(3px, ${(span.endRatio - span.startRatio) * 100}%)`,
                            top: `${(laneDefinitions[item.lane].position / SVG_HEIGHT) * 100}%`,
                          }}
                        />
                      );
                    })}
                  </div>
                ) : null}
              </div>
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
