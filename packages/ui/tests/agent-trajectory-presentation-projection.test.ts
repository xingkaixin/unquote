import { describe, expect, it } from "vitest";
import {
  type AgentSessionModel,
  type AgentTrajectoryItem,
  type AgentTrajectoryWarning,
} from "../src/lib/agent-session";
import {
  createAgentTrajectoryPresentation,
  filterAgentTrajectoryPresentation,
} from "../src/lib/agent-session/trajectory-presentation";
import {
  isWellFormed,
  selectionFor,
  eventFor,
  assistantItemFor,
  modelOutputItemFor,
  toolItemFor,
  turnFor,
  modelFor,
} from "./agent-trajectory-presentation.support";

describe("agent trajectory presentation: projection", () => {
  it("uses canonical event preview before label and falls back to label", () => {
    const previewEvent = eventFor("event-1", "Preview label", "Canonical preview");
    const labelEvent = eventFor("event-2", "Canonical label", "   ");
    const presentation = createAgentTrajectoryPresentation(
      modelFor(
        [previewEvent, labelEvent],
        [assistantItemFor("event-1"), assistantItemFor("event-2")],
      ),
    );

    expect(presentation.items.map((item) => item.summary)).toEqual([
      "Canonical preview",
      "Canonical label",
    ]);
    expect(presentation.items.map((item) => item.detail?.event)).toEqual([
      previewEvent,
      labelEvent,
    ]);
  });

  it("projects system activity into the activity lane and canonical kind filter", () => {
    const system = modelOutputItemFor("event-system", "system", 15);
    const presentation = createAgentTrajectoryPresentation(
      modelFor(
        [eventFor("event-system", "System label", "System preview")],
        [system],
        [turnFor("turn-system", [system])],
      ),
    );

    expect(presentation.items[0]).toMatchObject({
      item: {
        kind: "system",
        selection: selectionFor("event-system"),
      },
      detail: { recordId: "record-event-system" },
      summary: "System preview",
      lane: "activity",
    });
    expect(
      filterAgentTrajectoryPresentation(presentation, { kind: "system" }).visibleItems,
    ).toEqual(presentation.items);
    expect(
      filterAgentTrajectoryPresentation(presentation, { kind: "assistant" }).visibleItems,
    ).toEqual([]);
  });

  it("returns an empty summary without canonical text and keeps a real tool name", () => {
    const emptySystem = modelOutputItemFor("event-empty-system", "system");
    const emptyAssistant = assistantItemFor("event-empty-assistant");
    const namedTool = toolItemFor("event-named-tool", "completed", { toolName: "read_file" });
    const presentation = createAgentTrajectoryPresentation(
      modelFor(
        [
          eventFor("event-empty-system", "   ", "\t"),
          eventFor("event-empty-assistant", "", ""),
          eventFor("event-named-tool", "", ""),
        ],
        [emptySystem, emptyAssistant, namedTool],
      ),
    );

    expect(presentation.items.map((item) => item.summary)).toEqual(["", "", "read_file"]);
  });

  it("bounds a long canonical summary", () => {
    const event = eventFor("event-2a", "Label", "x".repeat(300));
    const presentation = createAgentTrajectoryPresentation(
      modelFor([event], [assistantItemFor("event-2a")]),
    );

    expect(presentation.items[0]?.summary).toHaveLength(240);
    expect(presentation.items[0]?.summary.endsWith("…")).toBe(true);
    expect(isWellFormed(presentation.items[0]?.summary ?? "")).toBe(true);
  });

  it("keeps a bounded surrogate pair intact", () => {
    const emoji = "🧪";
    const event = eventFor("event-2b", "Label", `${"a".repeat(238)}${emoji}z`);
    const presentation = createAgentTrajectoryPresentation(
      modelFor([event], [assistantItemFor("event-2b")]),
    );
    const item = presentation.items[0]!;

    expect(item.summary).toBe(`${"a".repeat(238)}…`);
    expect(item.summary).toHaveLength(239);
    expect(isWellFormed(item.summary)).toBe(true);
    expect(isWellFormed(item.searchText)).toBe(true);
    expect(filterAgentTrajectoryPresentation(presentation, { query: emoji }).visibleItems).toEqual(
      [],
    );
  });

  it("retains an emoji that fits within the summary boundary", () => {
    const emoji = "🧪";
    const preview = `${"a".repeat(237)}${emoji}z`;
    const event = eventFor("event-2c", "Label", preview);
    const presentation = createAgentTrajectoryPresentation(
      modelFor([event], [assistantItemFor("event-2c")]),
    );
    const item = presentation.items[0]!;

    expect(item.summary).toBe(preview);
    expect(item.summary).toHaveLength(240);
    expect(isWellFormed(item.summary)).toBe(true);
    expect(isWellFormed(item.searchText)).toBe(true);
    expect(filterAgentTrajectoryPresentation(presentation, { query: emoji }).visibleItems).toEqual([
      item,
    ]);
  });

  it("does not truncate text at the exact UTF-16 boundary", () => {
    const preview = "a".repeat(240);
    const event = eventFor("event-2d", "Label", preview);
    const presentation = createAgentTrajectoryPresentation(
      modelFor([event], [assistantItemFor("event-2d")]),
    );

    expect(presentation.items[0]?.summary).toBe(preview);
    expect(presentation.items[0]?.summary.endsWith("…")).toBe(false);
  });

  it.each([
    ["high", "\ud800", 0xd800],
    ["low", "\udc00", 0xdc00],
  ])(
    "preserves a pre-existing isolated %s surrogate without creating a pair",
    (_, surrogate, codeUnit) => {
      const preview = `${"a".repeat(238)}${surrogate}zz`;
      const event = eventFor("event-2e", "Label", preview);
      const presentation = createAgentTrajectoryPresentation(
        modelFor([event], [assistantItemFor("event-2e")]),
      );
      const summary = presentation.items[0]!.summary;

      expect(isWellFormed(preview)).toBe(false);
      expect(summary).toBe(`${"a".repeat(238)}${surrogate}…`);
      expect(isWellFormed(summary)).toBe(false);
      expect(summary.charCodeAt(238)).toBe(codeUnit);
      expect(summary.charCodeAt(239)).toBe(0x2026);
    },
  );

  it("bounds opaque search fields without changing canonical trajectory facts", () => {
    const opaqueId = `event-${"i".repeat(64 * 1024)}`;
    const opaqueLabel = `label-${"l".repeat(64 * 1024)}`;
    const opaquePreview = `preview-${"p".repeat(64 * 1024)}`;
    const opaqueCallId = `call-${"c".repeat(64 * 1024)}`;
    const opaqueTurnId = `turn-${"t".repeat(64 * 1024)}`;
    const canonicalSelection = selectionFor(opaqueId);
    const item = {
      ...toolItemFor("opaque-search", "completed", {
        callId: opaqueCallId,
        toolName: `tool-${"n".repeat(64 * 1024)}`,
      }),
      selection: canonicalSelection,
      recordId: canonicalSelection.recordId,
    } as AgentTrajectoryItem;
    const trajectorySelection = {
      kind: "trajectory" as const,
      id: item.id,
      recordId: item.recordId,
    };
    const baseModel = modelFor(
      [eventFor(opaqueId, opaqueLabel, opaquePreview)],
      [item],
      [turnFor(opaqueTurnId, [item])],
    );
    const model = {
      ...baseModel,
      selectTrajectory: (itemId: string) => (itemId === item.id ? trajectorySelection : null),
    } satisfies AgentSessionModel;

    const presentation = createAgentTrajectoryPresentation(model);
    const presentationItem = presentation.items[0]!;

    expect(presentationItem.searchText.length).toBeLessThan(3_000);
    expect(presentationItem.searchText).not.toContain(opaqueLabel);
    expect(presentationItem.searchText).not.toContain(opaquePreview);
    expect(presentationItem.searchText).not.toContain(opaqueCallId);
    expect(presentationItem.searchText).not.toContain(opaqueTurnId);
    expect(presentationItem.item.selection).toBe(canonicalSelection);
    expect(presentationItem.item.kind === "tool" ? presentationItem.item.callId : undefined).toBe(
      opaqueCallId,
    );
    expect(model.selectTrajectory(item.id)).toBe(trajectorySelection);
  });

  it("keeps repeated items from one Event and assigns each source item once", () => {
    const event = eventFor("event-3", "Repeated evidence", "");
    const first = {
      ...modelOutputItemFor("event-3", "assistant"),
      id: "event-3:evidence-0",
    } as AgentTrajectoryItem;
    const second = {
      ...modelOutputItemFor("event-3", "reasoning"),
      id: "event-3:evidence-1",
    } as AgentTrajectoryItem;
    const emptyTurn = turnFor("turn-empty", []);
    const assignedTurn = turnFor("turn-assigned", [first]);
    const model = modelFor([event], [first, second], [emptyTurn, assignedTurn]);
    let detailResolutions = 0;
    const presentation = createAgentTrajectoryPresentation({
      ...model,
      resolveDetail(selection) {
        detailResolutions += 1;
        return model.resolveDetail(selection);
      },
    });

    expect(detailResolutions).toBe(2);
    expect(presentation.items.map((item) => item.item.id)).toEqual([
      "event-3:evidence-0",
      "event-3:evidence-1",
    ]);
    expect(presentation.groups.map((group) => group.id)).toEqual([
      "turn-empty",
      "turn-assigned",
      "unassigned",
    ]);
    expect(presentation.groups[1]?.items.map((item) => item.item.id)).toEqual([
      "event-3:evidence-0",
    ]);
    expect(presentation.groups[2]?.items.map((item) => item.item.id)).toEqual([
      "event-3:evidence-1",
    ]);
  });

  it("keeps every source reference once when malformed items reuse an id", () => {
    const first = assistantItemFor("event-3a");
    const second = { ...first, lineNumber: 99 } as AgentTrajectoryItem;
    const presentation = createAgentTrajectoryPresentation(
      modelFor(
        [eventFor("event-3a", "Repeated id", "")],
        [first, second],
        [turnFor("turn-reused-id", [first])],
      ),
    );
    const groupedItems = presentation.groups.flatMap((group) => group.items);

    expect(groupedItems).toHaveLength(2);
    expect(groupedItems.map((item) => item.item.lineNumber)).toEqual([first.lineNumber, 99]);
    expect(presentation.groups.map((group) => group.id)).toEqual(["turn-reused-id", "unassigned"]);
  });

  it("assigns stable safe ordinals before filtering even when raw item ids repeat", () => {
    const opaqueId = `opaque-${"x".repeat(64 * 1024)}`;
    const first = { ...assistantItemFor("event-3b"), id: opaqueId } as AgentTrajectoryItem;
    const second = {
      ...first,
      kind: "reasoning",
      lineNumber: first.lineNumber + 1,
    } as AgentTrajectoryItem;
    const presentation = createAgentTrajectoryPresentation(
      modelFor(
        [eventFor("event-3b", "Repeated opaque id", "")],
        [first, second],
        [turnFor("turn-opaque", [first, second])],
      ),
    );
    const filtered = filterAgentTrajectoryPresentation(presentation, { kind: "reasoning" });

    expect(presentation.items.map((item) => item.ordinal)).toEqual([0, 1]);
    expect(presentation.groups.map((group) => group.ordinal)).toEqual([0]);
    expect(presentation.items.every((item) => Number.isSafeInteger(item.ordinal))).toBe(true);
    expect(presentation.groups.every((group) => Number.isSafeInteger(group.ordinal))).toBe(true);
    expect(filtered.visibleItems.map((item) => item.ordinal)).toEqual([1]);
    expect(
      filtered.ledgerRows.map((row) => (row.type === "item" ? row.item.ordinal : null)),
    ).toEqual([null, 1]);
    expect(
      filterAgentTrajectoryPresentation(presentation).visibleItems.map((item) => item.ordinal),
    ).toEqual([0, 1]);
  });

  it("derives the summary from trajectory facts without duplicating token components", () => {
    const first = assistantItemFor("event-4");
    const failedTool = toolItemFor("event-5", "failed");
    const third = modelOutputItemFor("event-6", "compaction");
    const warnings = [
      {
        kind: "unpaired-tool-call",
        callId: "call-4",
        recordId: "record-event-5",
        lineNumber: 5,
        selection: selectionFor("event-5"),
      } satisfies AgentTrajectoryWarning,
    ];
    const presentation = createAgentTrajectoryPresentation(
      modelFor(
        [
          eventFor("event-4", "First", ""),
          eventFor("event-5", "Tool", ""),
          eventFor("event-6", "Compact", ""),
        ],
        [first, failedTool, third],
        [
          turnFor("turn-4", [first], { durationMs: 12 }),
          turnFor("turn-5", [failedTool], { durationMs: 8 }),
          turnFor("turn-6", [third], { durationMs: -1 }),
          turnFor("turn-7", [], { durationMs: Number.POSITIVE_INFINITY }),
        ],
        warnings,
        {
          inputTokens: 21,
          outputTokens: 34,
          cacheReadInputTokens: 55,
          reasoningOutputTokens: 89,
        },
      ),
    );

    expect(presentation.summary).toEqual({
      turns: 4,
      events: 3,
      tools: 1,
      failures: 1,
      durationMs: 20,
      tokens: {
        inputTokens: 21,
        outputTokens: 34,
        cacheReadInputTokens: 55,
        reasoningOutputTokens: 89,
      },
      warningCount: 1,
    });
  });

  it("leaves duration absent without a finite non-negative turn duration", () => {
    const item = assistantItemFor("event-7");
    const presentation = createAgentTrajectoryPresentation(
      modelFor(
        [eventFor("event-7", "No duration", "")],
        [item],
        [turnFor("turn-unknown", [item]), turnFor("turn-invalid", [], { durationMs: -1 })],
      ),
    );

    expect(presentation.summary).not.toHaveProperty("durationMs");
  });

  it("uses a real tool name but leaves non-tool summaries empty when canonical text is absent", () => {
    const tool = toolItemFor("event-8", "completed", { toolName: "shell" });
    const compaction = modelOutputItemFor("event-9", "compaction");
    const presentation = createAgentTrajectoryPresentation(
      modelFor([eventFor("event-8", "  ", ""), eventFor("event-9", "", "  ")], [tool, compaction]),
    );

    expect(presentation.items.map((item) => item.summary)).toEqual(["shell", ""]);
  });
});
