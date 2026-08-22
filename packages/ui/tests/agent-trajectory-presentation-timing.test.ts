import { describe, expect, it } from "vitest";
import { createAgentTrajectoryPresentation } from "../src/lib/agent-session/trajectory-presentation";
import {
  eventFor,
  assistantItemFor,
  modelOutputItemFor,
  toolItemFor,
  turnFor,
  modelFor,
} from "./agent-trajectory-presentation.support";

describe("agent trajectory presentation: timing", () => {
  it("derives lanes, intervals, and a time domain from observed facts", () => {
    const user = modelOutputItemFor("event-10", "user", 10);
    const assistant = modelOutputItemFor("event-11", "assistant", 20);
    const partialTool = toolItemFor("event-12", "running", { timestamp: 30, startedAt: 30 });
    const completeTool = toolItemFor("event-13", "completed", { startedAt: 40, endedAt: 45 });
    const reversedTool = toolItemFor("event-14", "completed", {
      timestamp: 55,
      startedAt: 60,
      endedAt: 50,
    });
    const subagent = modelOutputItemFor("event-15", "subagent", 47);
    const compaction = modelOutputItemFor("event-16", "compaction", 48);
    const items = [user, assistant, partialTool, completeTool, reversedTool, subagent, compaction];
    const presentation = createAgentTrajectoryPresentation(
      modelFor(
        [
          eventFor("event-10", "User", ""),
          eventFor("event-11", "Assistant", ""),
          eventFor("event-12", "Partial", ""),
          eventFor("event-13", "Complete", ""),
          eventFor("event-14", "Reversed", ""),
          eventFor("event-15", "Subagent", ""),
          eventFor("event-16", "Compaction", ""),
        ],
        items,
        [turnFor("turn-time", items, { startedAt: 0, endedAt: 70 })],
      ),
    );

    expect(presentation.items.map((item) => item.lane)).toEqual([
      "activity",
      "model",
      "tool",
      "tool",
      "tool",
      "tool",
      "activity",
    ]);
    expect(presentation.items.map((item) => item.interval)).toEqual([
      { start: 10, end: 10 },
      { start: 20, end: 20 },
      { start: 30, end: 30 },
      { start: 40, end: 45 },
      null,
      { start: 47, end: 47 },
      { start: 48, end: 48 },
    ]);
    expect(presentation.timedItemCount).toBe(6);
    expect(presentation.timeDomain).toEqual({ start: 0, end: 70 });
  });

  it("does not invent a time point from a lone tool endpoint", () => {
    const startedOnly = toolItemFor("event-16a", "running", { startedAt: 30 });
    const endedOnly = toolItemFor("event-16b", "completed", { endedAt: 40 });
    const presentation = createAgentTrajectoryPresentation(
      modelFor(
        [eventFor("event-16a", "Started only", ""), eventFor("event-16b", "Ended only", "")],
        [startedOnly, endedOnly],
      ),
    );

    expect(presentation.items.map((item) => item.interval)).toEqual([null, null]);
    expect(presentation.timeDomain).toBeNull();
  });

  it("expands a single observed time into a one millisecond domain", () => {
    const item = modelOutputItemFor("event-17", "assistant", 100);
    const presentation = createAgentTrajectoryPresentation(
      modelFor([eventFor("event-17", "Only point", "")], [item]),
    );

    expect(presentation.timeDomain).toEqual({ start: 100, end: 101 });
  });

  it("returns no time domain when neither items nor turns provide time facts", () => {
    const presentation = createAgentTrajectoryPresentation(
      modelFor([eventFor("event-18", "No time", "")], [assistantItemFor("event-18")]),
    );

    expect(presentation.timeDomain).toBeNull();
  });
});
