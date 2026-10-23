import { describe, expect, it } from "vitest";
import { claudeTranscriptAdapter } from "../src/lib/agent-session/claude-adapter";
import { detectionSample, parsedLine, transcriptSample } from "./claude-adapter.support";

const buildSession = (records: unknown[]) => {
  const builder = claudeTranscriptAdapter.createBuilder();
  records.forEach((record, index) => builder.push(parsedLine(record, index + 1)));
  return builder.finish([]);
};

describe("claudeTranscriptAdapter: session metadata", () => {
  it("treats current Claude Code metadata records as meta events", () => {
    const session = buildSession([
      { type: "queue-operation", operation: "enqueue", sessionId: "session" },
      { type: "custom-title", customTitle: "Title", sessionId: "session" },
      { type: "cost-state", totalCostUSD: 0, sessionId: "session" },
      { type: "file-history-delta", messageId: "message" },
      { type: "future-record", sessionId: "session" },
    ]);

    expect(session.events.map((event) => event.category)).toEqual([
      "meta",
      "meta",
      "meta",
      "meta",
      "unknown",
    ]);
  });

  it("accepts a newer metadata record as detection evidence", () => {
    expect(
      claudeTranscriptAdapter.detect([
        transcriptSample(1),
        detectionSample({ type: "queue-operation", hasSessionId: true }),
      ]),
    ).toBe(0.6);
  });

  it("prefers the latest custom title over a generated one", () => {
    const session = buildSession([
      { type: "custom-title", customTitle: "First", sessionId: "session" },
      { type: "custom-title", customTitle: "Renamed", sessionId: "session" },
      { type: "ai-title", aiTitle: "Generated", sessionId: "session" },
    ]);

    expect(session.meta.title).toBe("Renamed");
    expect(buildSession([{ type: "ai-title", aiTitle: "Generated" }]).meta.title).toBe("Generated");
  });

  it("keeps the totals from the last cost-state record", () => {
    const session = buildSession([
      { type: "cost-state", totalCostUSD: 0.5, totalLinesAdded: 1, sessionId: "session" },
      {
        type: "cost-state",
        sessionId: "session",
        totalCostUSD: 1.25,
        hasUnknownModelCost: true,
        totalAPIDuration: 90_000,
        totalToolDuration: 4_200,
        totalLinesAdded: 12,
        totalLinesRemoved: 3,
        totalDuration: 600_000,
        modelUsage: {},
      },
    ]);

    expect(session.meta.reportedTotals).toEqual({
      costUSD: 1.25,
      hasUnknownModelCost: true,
      apiDurationMs: 90_000,
      toolDurationMs: 4_200,
      linesAdded: 12,
      linesRemoved: 3,
    });
  });

  it("drops cost-state fields that are not non-negative numbers", () => {
    const session = buildSession([
      {
        type: "cost-state",
        totalCostUSD: "1.25",
        totalAPIDuration: -1,
        totalLinesAdded: 4,
        hasUnknownModelCost: false,
      },
    ]);

    expect(session.meta.reportedTotals).toEqual({ linesAdded: 4 });
    expect(buildSession([{ type: "cost-state" }]).meta).not.toHaveProperty("reportedTotals");
  });
});
