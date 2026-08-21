import type { AgentTrajectoryTimeRange } from "../lib/agent-session/trajectory-time";
import type { Locale } from "../i18n/i18n";
import { formatClockTime } from "../lib/format";
import { formatTimestamp } from "./agent-session-format";
import { formatTrajectoryDuration } from "./agent-trajectory-format";

const RANGE_KEYBOARD_INCREMENT_COUNT = 100;

export const finiteTrajectoryRange = (range: AgentTrajectoryTimeRange | null) => {
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

export const rangeCoordinateMax = (domain: AgentTrajectoryTimeRange) =>
  finiteDomainSpan(domain) ?? 1;

const usableStepWithin = (candidate: number, span: number) =>
  Number.isFinite(candidate) && candidate > 0 && candidate <= span ? candidate : 0;

export const trajectoryRangeStep = (domain: AgentTrajectoryTimeRange | null) => {
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

export const coordinateForTrajectoryRangeValue = (
  value: number,
  domain: AgentTrajectoryTimeRange,
) => {
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

export const trajectoryRangeValueFromInput = (
  value: string,
  currentValue: number,
  domain: AgentTrajectoryTimeRange,
) => {
  const coordinate = Number(value);
  if (!Number.isFinite(coordinate)) {
    return null;
  }
  const maximum = rangeCoordinateMax(domain);
  const snapped = snapRangeCoordinate(coordinate, maximum, trajectoryRangeStep(domain));
  const currentCoordinate = coordinateForTrajectoryRangeValue(currentValue, domain);
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
  locale: Locale,
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

const formatSubMillisecondOffset = (offset: number, locale: Locale) =>
  new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "millisecond",
    unitDisplay: "short",
    signDisplay: "always",
    notation: offset !== 0 && Math.abs(offset) < 0.001 ? "scientific" : "standard",
    maximumSignificantDigits: 15,
  }).format(offset);

export const formatTrajectoryRangeValue = (
  value: number,
  domain: AgentTrajectoryTimeRange,
  locale: Locale,
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

export const trajectoryTickTimeLabel = (value: number, locale: Locale) => {
  if (Number.isNaN(new Date(value).getTime())) {
    return new Intl.NumberFormat(locale, {
      notation: "scientific",
      maximumSignificantDigits: 6,
    }).format(value);
  }
  return formatClockTime(value, locale);
};

export const trajectoryTickOffsetLabel = (offsetMs: number, locale: Locale) => {
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

export const clampTrajectoryRange = (
  range: AgentTrajectoryTimeRange | null,
  bounds: AgentTrajectoryTimeRange,
) => {
  const candidate = finiteTrajectoryRange(range);
  if (!candidate) {
    return bounds;
  }
  const start = Math.min(bounds.end, Math.max(bounds.start, candidate.start));
  const end = Math.min(bounds.end, Math.max(bounds.start, candidate.end));
  return start <= end ? { start, end } : { start: end, end: start };
};
