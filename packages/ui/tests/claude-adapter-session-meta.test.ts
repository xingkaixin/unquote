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
});
