import { describe, expect, it } from "vitest";
import {
  type AgentTimelineEvent,
  type AgentTrajectoryItem,
  type AgentTrajectoryTurn,
} from "../src/lib/agent-session";
import { createAgentTrajectoryPresentation } from "../src/lib/agent-session/trajectory-presentation";
import {
  createAgentTrajectoryOverview,
  trajectoryOverviewBucketCount,
} from "../src/lib/agent-session/trajectory-overview";
import {
  createTrajectoryTimeScale,
  trajectoryOverviewSpans,
  zoomTrajectoryViewport,
} from "../src/lib/agent-session/trajectory-time-scale";
import {
  eventFor,
  modelOutputItemFor,
  toolItemFor,
  turnFor,
  modelFor,
} from "./agent-trajectory-presentation.support";

describe("agent trajectory presentation: overview", () => {
  it("bounds bucket counts by minimum width, hard maximum, and invalid inputs", () => {
    expect(trajectoryOverviewBucketCount(120, 0)).toBe(0);
    expect(trajectoryOverviewBucketCount(120, Number.NaN)).toBe(0);
    expect(trajectoryOverviewBucketCount(-1, 4)).toBe(1);
    expect(trajectoryOverviewBucketCount(Number.NaN, 4)).toBe(1);
    expect(trajectoryOverviewBucketCount(5, 4)).toBe(1);
    expect(trajectoryOverviewBucketCount(6, 4)).toBe(1);
    expect(trajectoryOverviewBucketCount(3_600, 4)).toBe(512);
  });

  it("aggregates three lanes and turn boundaries without emitting event collections", () => {
    const activity = modelOutputItemFor("event-30", "user", 5);
    const completed = toolItemFor("event-31", "completed", { timestamp: 10 });
    const running = toolItemFor("event-32", "running", { timestamp: 11 });
    const failed = toolItemFor("event-33", "failed", { timestamp: 12 });
    const model = modelOutputItemFor("event-34", "assistant", 15);
    const items = [activity, completed, running, failed, model];
    const presentation = createAgentTrajectoryPresentation(
      modelFor(
        [
          eventFor("event-30", "Activity", ""),
          eventFor("event-31", "Complete", ""),
          eventFor("event-32", "Running", ""),
          eventFor("event-33", "Failed", ""),
          eventFor("event-34", "Model", ""),
        ],
        items,
        [turnFor("turn-failed", items, { status: "failed", startedAt: 0, endedAt: 20 })],
      ),
    );
    const overview = createAgentTrajectoryOverview(presentation, { start: 0, end: 20 }, 1);

    expect(overview.viewport).toEqual({ start: 0, end: 20 });
    expect(overview.lanes.activity).toEqual([
      { count: 1, interval: { start: 5, end: 5 }, status: "completed", kind: "user" },
    ]);
    expect(overview.lanes.model).toEqual([
      { count: 1, interval: { start: 15, end: 15 }, status: "completed", kind: "assistant" },
    ]);
    expect(overview.lanes.tool).toEqual([
      { count: 3, interval: { start: 10, end: 12 }, status: "failed", kind: "tool" },
    ]);
    expect(overview.turnBoundaries).toEqual([
      { count: 2, interval: { start: 0, end: 20 }, status: "failed", kind: null },
    ]);
    expect(Object.keys(overview.lanes.tool[0]!).sort()).toEqual([
      "count",
      "interval",
      "kind",
      "status",
    ]);
  });

  it("ranks aborted status above running and completed status", () => {
    const completed = toolItemFor("event-35", "completed", { timestamp: 10 });
    const running = toolItemFor("event-36", "running", { timestamp: 11 });
    const aborted = {
      ...modelOutputItemFor("event-37", "subagent", 12),
      status: "aborted",
    } as AgentTrajectoryItem;
    const presentation = createAgentTrajectoryPresentation(
      modelFor(
        [
          eventFor("event-35", "Completed", ""),
          eventFor("event-36", "Running", ""),
          eventFor("event-37", "Aborted", ""),
        ],
        [completed, running, aborted],
      ),
    );
    const overview = createAgentTrajectoryOverview(presentation, presentation.timeDomain, 1);

    expect(overview.lanes.tool[0]).toMatchObject({ count: 3, status: "aborted" });
  });

  it("keeps overview output bounded for 5,005 items and 556 turns", () => {
    const events: AgentTimelineEvent[] = [];
    const items: AgentTrajectoryItem[] = [];
    const turns: AgentTrajectoryTurn[] = [];
    for (let index = 0; index < 5_005; index += 1) {
      const id = `event-${index + 100}`;
      events.push(eventFor(id, id, ""));
      items.push(modelOutputItemFor(id, "assistant", index));
    }
    for (let index = 0; index < 556; index += 1) {
      turns.push(turnFor(`turn-${index}`, [], { startedAt: index, endedAt: index + 1 }));
    }
    const presentation = createAgentTrajectoryPresentation(modelFor(events, items, turns));
    const bucketCount = trajectoryOverviewBucketCount(10_000, presentation.timedItemCount);
    const overview = createAgentTrajectoryOverview(
      presentation,
      presentation.timeDomain,
      bucketCount,
    );

    expect(bucketCount).toBe(512);
    expect(overview.bucketCount).toBe(512);
    expect(overview.lanes.activity).toHaveLength(512);
    expect(overview.lanes.model).toHaveLength(512);
    expect(overview.lanes.tool).toHaveLength(512);
    expect(overview.turnBoundaries).toHaveLength(512);
    expect(Object.keys(overview.turnBoundaries[0]!).sort()).toEqual([
      "count",
      "interval",
      "kind",
      "status",
    ]);
  });

  it("compresses long idle stretches on the time scale and keeps active time linear", () => {
    // Two clusters at [0, 100s] and [10_000s, 10_100s] with a 2.75-hour idle stretch.
    const first = modelOutputItemFor("event-60", "assistant", 0);
    const second = modelOutputItemFor("event-61", "assistant", 100_000);
    const third = modelOutputItemFor("event-62", "assistant", 10_000_000);
    const fourth = modelOutputItemFor("event-63", "assistant", 10_100_000);
    const presentation = createAgentTrajectoryPresentation(
      modelFor(
        [
          eventFor("event-60", "A", ""),
          eventFor("event-61", "B", ""),
          eventFor("event-62", "C", ""),
          eventFor("event-63", "D", ""),
        ],
        [first, second, third, fourth],
      ),
    );
    const scale = createTrajectoryTimeScale(presentation, presentation.timeDomain)!;

    expect(scale.gaps).toEqual([{ start: 100_000, end: 10_000_000 }]);
    // The gap collapses to 3% of the compressed width, so the two equal active
    // clusters each take (1 − 0.03) / 2 = 48.5% instead of ~1%.
    expect(scale.toRatio(0)).toBe(0);
    expect(scale.toRatio(100_000)).toBeCloseTo(0.485, 6);
    expect(scale.toRatio(10_000_000)).toBeCloseTo(0.515, 6);
    expect(scale.toRatio(10_100_000)).toBe(1);
    // The inverse restores the original moments.
    expect(scale.fromRatio(scale.toRatio(50_000))).toBeCloseTo(50_000, 3);
    expect(scale.fromRatio(scale.toRatio(10_050_000))).toBeCloseTo(10_050_000, 3);

    const spans = trajectoryOverviewSpans(presentation, presentation.timeDomain, 100)!;
    expect(spans[1]!.startRatio).toBeCloseTo(0.485, 6);
    expect(spans[2]!.startRatio).toBeCloseTo(0.515, 6);
  });

  it("keeps ordinary pauses between sparse events on a linear time scale", () => {
    const timestamps = [0, 20, 40, 60, 80, 100];
    const presentation = createAgentTrajectoryPresentation(
      modelFor(
        timestamps.map((_, index) => eventFor(`event-6${index + 4}`, "Sparse", "")),
        timestamps.map((timestamp, index) =>
          modelOutputItemFor(`event-6${index + 4}`, "assistant", timestamp),
        ),
      ),
    );
    const scale = createTrajectoryTimeScale(presentation, { start: 0, end: 100 })!;

    expect(scale.gaps).toEqual([]);
    expect(scale.toRatio(25)).toBeCloseTo(0.25, 9);
    expect(scale.fromRatio(0.25)).toBeCloseTo(25, 9);
  });

  it("zooms around the viewport center and clamps safely to the full domain", () => {
    const domain = { start: 0, end: 100 };

    expect(zoomTrajectoryViewport(domain, { start: 20, end: 60 }, 2)).toEqual({
      start: 30,
      end: 50,
    });
    expect(zoomTrajectoryViewport(domain, { start: 0, end: 20 }, 2)).toEqual({
      start: 5,
      end: 15,
    });
    expect(zoomTrajectoryViewport(domain, { start: 20, end: 60 }, 0.1)).toEqual(domain);
    expect(zoomTrajectoryViewport(domain, { start: 20, end: 60 }, Number.NaN)).toEqual(domain);
    expect(zoomTrajectoryViewport(domain, { start: 80, end: 20 }, 2)).toEqual(domain);
  });
});
