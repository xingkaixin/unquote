import { describe, expect, it } from "vitest";
import {
  clampTrajectoryRange,
  coordinateForTrajectoryRangeValue,
  finiteTrajectoryRange,
  formatTrajectoryRangeValue,
  rangeCoordinateMax,
  trajectoryRangeStep,
  trajectoryRangeValueFromInput,
} from "../src/components/agent-trajectory-overview-range";

describe("agent trajectory overview range", () => {
  it("maps ordinary timestamps through offset coordinates", () => {
    const domain = { start: 200, end: 300 };

    expect(rangeCoordinateMax(domain)).toBe(100);
    expect(trajectoryRangeStep(domain)).toBe(1);
    expect(coordinateForTrajectoryRangeValue(210, domain)).toBe(10);
    expect(trajectoryRangeValueFromInput("20.49", 210, domain)).toBe(220);
  });

  it("uses normalized coordinates when subtracting the domain would overflow", () => {
    const domain = { start: -Number.MAX_VALUE, end: Number.MAX_VALUE };

    expect(rangeCoordinateMax(domain)).toBe(1);
    expect(trajectoryRangeStep(domain)).toBe(0.01);
    expect(coordinateForTrajectoryRangeValue(domain.start, domain)).toBe(0);
    expect(coordinateForTrajectoryRangeValue(domain.end, domain)).toBe(1);

    const advanced = trajectoryRangeValueFromInput("0.01", domain.start, domain);
    expect(advanced).not.toBeNull();
    expect(Number.isFinite(advanced)).toBe(true);
    expect(advanced).toBeGreaterThan(domain.start);
    expect(advanced).toBeLessThan(domain.end);
  });

  it("validates and clamps externally supplied ranges", () => {
    const bounds = { start: 100, end: 200 };

    expect(finiteTrajectoryRange({ start: Number.NaN, end: 150 })).toBeNull();
    expect(finiteTrajectoryRange({ start: 160, end: 150 })).toBeNull();
    expect(clampTrajectoryRange(null, bounds)).toBe(bounds);
    expect(clampTrajectoryRange({ start: 50, end: 250 }, bounds)).toEqual(bounds);
  });

  it("keeps adjacent invalid-Date values distinct and bounded", () => {
    const domain = { start: 1e16, end: 1e16 + 2 };
    const start = formatTrajectoryRangeValue(domain.start, domain, "en");
    const end = formatTrajectoryRangeValue(domain.end, domain, "en");

    expect(start).not.toBe(end);
    expect(start).toContain("E");
    expect(end).toContain("E");
    expect(Math.max(start.length, end.length)).toBeLessThanOrEqual(80);
  });
});
