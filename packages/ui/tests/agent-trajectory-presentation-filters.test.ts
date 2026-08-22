import { describe, expect, it } from "vitest";
import {
  createAgentTrajectoryPresentation,
  filterAgentTrajectoryPresentation,
} from "../src/lib/agent-session/trajectory-presentation";
import {
  eventFor,
  modelOutputItemFor,
  toolItemFor,
  turnFor,
  modelFor,
} from "./agent-trajectory-presentation.support";

describe("agent trajectory presentation: filters", () => {
  const presentationForFiltering = () => {
    const assistant = modelOutputItemFor("event-20", "assistant", 10);
    const tool = toolItemFor("event-21", "failed", {
      timestamp: 20,
      toolName: "inspect-needle",
      callId: "call-needle",
    });
    const untimed = modelOutputItemFor("event-22", "compaction");
    const turn = turnFor("turn-needle", [assistant, tool, untimed], { turnIndex: 7 });
    return createAgentTrajectoryPresentation(
      modelFor(
        [
          eventFor("event-20", "Assistant label", "assistant preview"),
          eventFor("event-21", "Tool label", "tool preview"),
          eventFor("event-22", "Compaction needle", ""),
        ],
        [assistant, tool, untimed],
        [turn],
      ),
    );
  };

  it("intersects text, kind, and time filters while retaining untimed items", () => {
    const presentation = presentationForFiltering();
    const toolOnly = filterAgentTrajectoryPresentation(presentation, {
      query: "needle",
      kind: "tool",
      timeRange: { start: 20, end: 20 },
    });
    const untimed = filterAgentTrajectoryPresentation(presentation, {
      query: "needle",
      kind: "compaction",
      timeRange: { start: 20, end: 20 },
    });

    expect(toolOnly.visibleItems.map((item) => item.item.id)).toEqual(["item-event-21"]);
    expect(toolOnly.ledgerRows).toMatchObject([
      { type: "turn-header", group: { id: "turn-needle" } },
      { type: "item", positionInSet: 1, setSize: 1, item: { item: { id: "item-event-21" } } },
    ]);
    expect(untimed.visibleItems.map((item) => item.item.id)).toEqual(["item-event-22"]);
  });

  it("filters by item status and composes it with the other filters", () => {
    const presentation = presentationForFiltering();

    const failedOnly = filterAgentTrajectoryPresentation(presentation, { status: "failed" });
    expect(failedOnly.visibleItems.map((item) => item.item.id)).toEqual(["item-event-21"]);

    const completedOnly = filterAgentTrajectoryPresentation(presentation, { status: "completed" });
    expect(completedOnly.visibleItems.map((item) => item.item.id)).toEqual([
      "item-event-20",
      "item-event-22",
    ]);

    const failedCompaction = filterAgentTrajectoryPresentation(presentation, {
      status: "failed",
      kind: "compaction",
    });
    expect(failedCompaction.visibleItems).toEqual([]);
  });

  it("reports positions within each filtered ledger group", () => {
    const presentation = presentationForFiltering();
    const filtered = filterAgentTrajectoryPresentation(presentation, { kind: "tool" });
    const itemRows = filtered.ledgerRows.filter(
      (row): row is Extract<typeof row, { type: "item" }> => row.type === "item",
    );

    expect(itemRows.map(({ positionInSet, setSize }) => ({ positionInSet, setSize }))).toEqual([
      { positionInSet: 1, setSize: 1 },
    ]);
  });

  it("uses global filtered-list positions while excluding turn headers", () => {
    const first = modelOutputItemFor("global-first", "assistant", 10);
    const second = toolItemFor("global-second", "completed", { timestamp: 20 });
    const third = modelOutputItemFor("global-third", "assistant", 30);
    const presentation = createAgentTrajectoryPresentation(
      modelFor(
        [
          eventFor("global-first", "First", ""),
          eventFor("global-second", "Second", ""),
          eventFor("global-third", "Third", ""),
        ],
        [first, second, third],
        [turnFor("turn-first", [first, second]), turnFor("turn-second", [third])],
      ),
    );
    const allRows = filterAgentTrajectoryPresentation(presentation).ledgerRows;
    const allItemRows = allRows.filter(
      (row): row is Extract<typeof row, { type: "item" }> => row.type === "item",
    );
    const assistantRows = filterAgentTrajectoryPresentation(presentation, {
      kind: "assistant",
    }).ledgerRows;
    const assistantItemRows = assistantRows.filter(
      (row): row is Extract<typeof row, { type: "item" }> => row.type === "item",
    );

    expect(allRows.filter((row) => row.type === "turn-header")).toHaveLength(2);
    expect(allItemRows.map(({ positionInSet, setSize }) => ({ positionInSet, setSize }))).toEqual([
      { positionInSet: 1, setSize: 3 },
      { positionInSet: 2, setSize: 3 },
      { positionInSet: 3, setSize: 3 },
    ]);
    expect(
      assistantItemRows.map(({ positionInSet, setSize }) => ({ positionInSet, setSize })),
    ).toEqual([
      { positionInSet: 1, setSize: 2 },
      { positionInSet: 2, setSize: 2 },
    ]);
  });

  it("matches canonical labels, previews, status, tool facts, line, and turn text", () => {
    const presentation = presentationForFiltering();
    const queries = [
      "tool label",
      "tool preview",
      "failed",
      "inspect-needle",
      "call-needle",
      "line 21",
      "turn-needle",
    ];

    for (const query of queries) {
      expect(
        filterAgentTrajectoryPresentation(presentation, { query }).visibleItems.map(
          (item) => item.item.id,
        ),
      ).toContain("item-event-21");
    }
  });

  it("uses inclusive overlap for both point and interval time boundaries", () => {
    const point = modelOutputItemFor("event-23", "assistant", 20);
    const span = toolItemFor("event-24", "completed", { startedAt: 30, endedAt: 40 });
    const presentation = createAgentTrajectoryPresentation(
      modelFor(
        [eventFor("event-23", "Point", ""), eventFor("event-24", "Span", "")],
        [point, span],
      ),
    );

    expect(
      filterAgentTrajectoryPresentation(presentation, { timeRange: { start: 20, end: 20 } })
        .visibleItems,
    ).toHaveLength(1);
    expect(
      filterAgentTrajectoryPresentation(presentation, { timeRange: { start: 40, end: 45 } })
        .visibleItems,
    ).toHaveLength(1);
  });

  it("omits empty turn headers from the filtered ledger", () => {
    const first = modelOutputItemFor("event-25", "assistant", 10);
    const second = toolItemFor("event-26", "completed", { timestamp: 20 });
    const presentation = createAgentTrajectoryPresentation(
      modelFor(
        [eventFor("event-25", "Assistant", ""), eventFor("event-26", "Tool", "")],
        [first, second],
        [turnFor("turn-assistant", [first]), turnFor("turn-tool", [second])],
      ),
    );

    expect(
      filterAgentTrajectoryPresentation(presentation, { kind: "tool" }).ledgerRows.map((row) =>
        row.type === "turn-header" ? row.group.id : row.item.item.id,
      ),
    ).toEqual(["turn-tool", "item-event-26"]);
  });
});
