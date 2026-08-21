import { describe, expect, it } from "vitest";
import type { AgentCanonicalSelection } from "../src/lib/agent-session/types";
import {
  createAgentTrajectoryModel,
  type AgentDetailSelection,
  type AgentSession,
  type AgentSessionDetail,
  type AgentSessionModel,
  type AgentTimelineEvent,
  type AgentTrajectoryItem,
  type AgentTrajectoryModel,
  type AgentTrajectoryStatus,
  type AgentTrajectoryTurn,
  type AgentTrajectoryWarning,
} from "../src/lib/agent-session";
import {
  agentTrajectoryWarningKinds,
  createAgentTrajectoryPresentation,
  filterAgentTrajectoryPresentation,
} from "../src/lib/agent-session/trajectory-presentation";
import {
  createAgentTrajectoryOverview,
  trajectoryOverviewBucketCount,
} from "../src/lib/agent-session/trajectory-overview";
import {
  createTrajectoryTimeScale,
  trajectoryOverviewSpans,
  zoomTrajectoryViewport,
} from "../src/lib/agent-session/trajectory-time-scale";

const isWellFormed = (value: string) =>
  (String.prototype as unknown as { isWellFormed: (this: string) => boolean }).isWellFormed.call(
    value,
  );

const selectionFor = (id: string): AgentCanonicalSelection => ({
  kind: "event",
  id,
  recordId: `record-${id}`,
});

const eventFor = (id: string, label: string, preview: string): AgentTimelineEvent => ({
  id,
  recordId: `record-${id}`,
  lineNumber: Number(id.replace(/\D/g, "")) || 1,
  category: "assistant",
  kind: "message",
  label,
  preview,
  conversationItems: [],
});

const assistantItemFor = (id: string): AgentTrajectoryItem => ({
  id: `item-${id}`,
  kind: "assistant",
  status: "completed",
  recordId: `record-${id}`,
  lineNumber: Number(id.replace(/\D/g, "")) || 1,
  selection: selectionFor(id),
});

const modelOutputItemFor = (
  id: string,
  kind: "user" | "system" | "assistant" | "reasoning" | "subagent" | "compaction" = "assistant",
  timestamp?: number,
): AgentTrajectoryItem => {
  const status: AgentTrajectoryStatus = kind === "subagent" ? "running" : "completed";
  return {
    id: `item-${id}`,
    kind,
    status,
    recordId: `record-${id}`,
    lineNumber: Number(id.replace(/\D/g, "")) || 1,
    selection: selectionFor(id),
    ...(timestamp === undefined ? {} : { timestamp }),
  } as AgentTrajectoryItem;
};

const toolItemFor = (
  id: string,
  status: "running" | "completed" | "failed" = "completed",
  options: {
    timestamp?: number;
    startedAt?: number;
    endedAt?: number;
    toolName?: string;
    callId?: string;
    callSelection?: AgentCanonicalSelection;
    resultSelection?: AgentCanonicalSelection;
    completionSelection?: AgentCanonicalSelection;
  } = {},
): AgentTrajectoryItem => ({
  id: `item-${id}`,
  kind: "tool",
  status,
  recordId: `record-${id}`,
  lineNumber: Number(id.replace(/\D/g, "")) || 1,
  selection: selectionFor(id),
  ...(options.timestamp === undefined ? {} : { timestamp: options.timestamp }),
  ...(options.startedAt === undefined ? {} : { startedAt: options.startedAt }),
  ...(options.endedAt === undefined ? {} : { endedAt: options.endedAt }),
  ...(options.toolName === undefined ? {} : { toolName: options.toolName }),
  ...(options.callId === undefined ? {} : { callId: options.callId }),
  ...(options.callSelection === undefined ? {} : { callSelection: options.callSelection }),
  ...(options.resultSelection === undefined ? {} : { resultSelection: options.resultSelection }),
  ...(options.completionSelection === undefined
    ? {}
    : { completionSelection: options.completionSelection }),
});

const turnFor = (
  id: string,
  items: readonly AgentTrajectoryItem[],
  options: {
    status?: AgentTrajectoryStatus;
    startedAt?: number;
    endedAt?: number;
    durationMs?: number;
    turnIndex?: number;
  } = {},
): AgentTrajectoryTurn => ({
  id,
  status: options.status ?? "completed",
  items,
  ...(options.startedAt === undefined ? {} : { startedAt: options.startedAt }),
  ...(options.endedAt === undefined ? {} : { endedAt: options.endedAt }),
  ...(options.durationMs === undefined ? {} : { durationMs: options.durationMs }),
  ...(options.turnIndex === undefined ? {} : { turnIndex: options.turnIndex }),
});

const modelFor = (
  events: readonly AgentTimelineEvent[],
  items: readonly AgentTrajectoryItem[],
  turns: readonly AgentTrajectoryTurn[] = [],
  warnings: readonly AgentTrajectoryWarning[] = [],
  tokenUsage: AgentTrajectoryModel["stats"]["tokenUsage"] = {},
): AgentSessionModel => {
  const eventById = new Map(events.map((event) => [event.id, event]));
  const eventByRecordId = new Map(events.map((event) => [event.recordId, event]));
  const trajectory: AgentTrajectoryModel = {
    turns,
    items,
    warnings,
    stats: {
      tokenUsage,
    },
  };

  const resolveDetail = (selection: AgentDetailSelection | null): AgentSessionDetail | null => {
    const event =
      selection?.kind === "record"
        ? eventByRecordId.get(selection.recordId)
        : selection
          ? eventById.get(selection.id)
          : events[0];
    return event ? { event, recordId: event.recordId } : null;
  };

  return {
    events,
    conversation: [],
    integrityIssues: [],
    trajectory,
    resolveDetail,
    selectEvent: (id) => (eventById.has(id) ? selectionFor(id) : null),
    selectConversation: () => null,
    selectTrajectory: () => null,
    resolveToolStatus: () => "pending",
    resolveToolName: () => undefined,
  };
};

const warningGroupsFor = (warnings: readonly AgentTrajectoryWarning[]) =>
  warnings.map((warning) => ({ warning, count: 1 }));

const warningForKind = (
  kind: AgentTrajectoryWarning["kind"],
  lineNumber: number,
  selection: AgentCanonicalSelection,
): AgentTrajectoryWarning => {
  const base = { recordId: selection.recordId, lineNumber, selection };
  switch (kind) {
    case "missing-timestamp":
      return { ...base, kind, subject: "turn", endpoint: "terminal", turnId: "turn-warning" };
    case "missing-turn-start":
      return { ...base, kind, turnId: "turn-warning" };
    case "reversed-timestamp":
      return { ...base, kind, subject: "turn", turnId: "turn-warning" };
    case "unpaired-tool-call":
    case "unpaired-tool-result":
    case "unpaired-tool-completion":
      return { ...base, kind, callId: `call-${kind}` };
    case "duplicate-tool-call-id":
    case "duplicate-tool-result-id":
    case "duplicate-tool-completion-id":
      return { ...base, kind, callId: `call-${kind}` };
    case "open-turn":
      return { ...base, kind, turnId: "turn-warning" };
    case "unattached-token-usage":
      return { ...base, kind };
  }
};

describe("createAgentTrajectoryPresentation", () => {
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
    expect(presentation.items.map((item) => item.groupId)).toEqual(["turn-assigned", "unassigned"]);
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

  it("attaches a warning without a call id only to its unique canonical candidate", () => {
    const selection = selectionFor("unique-no-call");
    const item = toolItemFor("unique-no-call-tool", "running", { callSelection: selection });
    const warning = {
      kind: "unpaired-tool-call",
      recordId: selection.recordId,
      lineNumber: 8,
      selection,
    } satisfies AgentTrajectoryWarning;

    const presentation = createAgentTrajectoryPresentation(modelFor([], [item], [], [warning]));

    expect(presentation.items[0]?.warningGroups).toEqual(warningGroupsFor([warning]));
    expect(presentation.unattachedWarningGroups).toEqual([]);
  });

  it("attaches a warning with an exact call id without crossing shared canonical candidates", () => {
    const callSelection = selectionFor("call-evidence");
    const first = toolItemFor("tool-one", "running", {
      callId: "call-one",
      callSelection,
    });
    const second = toolItemFor("tool-two", "running", {
      callId: "call-two",
      callSelection,
    });
    const warning = {
      kind: "unpaired-tool-call",
      callId: "call-one",
      recordId: "record-call-evidence",
      lineNumber: 7,
      selection: callSelection,
    } satisfies AgentTrajectoryWarning;
    const presentation = createAgentTrajectoryPresentation(
      modelFor(
        [
          eventFor("tool-one", "First tool", ""),
          eventFor("tool-two", "Second tool", ""),
          eventFor("call-evidence", "Call evidence", ""),
        ],
        [first, second],
        [],
        [warning],
      ),
    );

    expect(presentation.items.map((item) => item.warningGroups)).toEqual([
      warningGroupsFor([warning]),
      [],
    ]);
  });

  it("matches same-selection warning call ids without rescanning every tool", () => {
    const itemCount = 32;
    const sharedCallSelection = selectionFor("shared-call-evidence");
    let callIdReads = 0;
    const items = Array.from({ length: itemCount }, (_, index) => {
      const item = toolItemFor(`tool-candidate-${index}`, "running", {
        callId: `call-${index}`,
        callSelection: sharedCallSelection,
      });
      Object.defineProperty(item, "callId", {
        configurable: true,
        enumerable: true,
        get() {
          callIdReads += 1;
          return `call-${index}`;
        },
      });
      return item;
    });
    const warnings: AgentTrajectoryWarning[] = items.map((item, index) => ({
      kind: "unpaired-tool-call",
      callId: `call-${index}`,
      recordId: sharedCallSelection.recordId,
      lineNumber: item.lineNumber,
      selection: sharedCallSelection,
    }));

    const presentation = createAgentTrajectoryPresentation(modelFor([], items, [], warnings));

    expect(presentation.items.map((item) => item.warningGroups)).toEqual(
      warnings.map((warning) => [{ warning, count: 1 }]),
    );
    expect(callIdReads).toBeLessThanOrEqual(itemCount * 2);
  });

  it("keeps duplicate canonical selection and call id candidates unattached", () => {
    const selection = selectionFor("duplicate-call");
    const first = toolItemFor("duplicate-first", "running", {
      callId: "call-duplicate",
      callSelection: selection,
    });
    const second = toolItemFor("duplicate-second", "running", {
      callId: "call-duplicate",
      callSelection: selection,
    });
    const warning = {
      kind: "unpaired-tool-call",
      callId: "call-duplicate",
      recordId: selection.recordId,
      lineNumber: 10,
      selection,
    } satisfies AgentTrajectoryWarning;

    const presentation = createAgentTrajectoryPresentation(
      modelFor([], [first, second], [], [warning]),
    );

    expect(presentation.items.map((item) => item.warningGroups)).toEqual([[], []]);
    expect(presentation.unattachedWarningGroups).toEqual(warningGroupsFor([warning]));
  });

  it("keeps 5,005 ambiguous no-call warnings unattached and bounded", () => {
    const count = 5_005;
    const sharedSelection = selectionFor("broadcast-evidence");
    const items = Array.from({ length: count }, (_, index) =>
      toolItemFor(`broadcast-${index}`, "running", { callSelection: sharedSelection }),
    );
    const warnings: AgentTrajectoryWarning[] = Array.from({ length: count }, (_, index) => ({
      kind: "unpaired-tool-call",
      recordId: sharedSelection.recordId,
      lineNumber: index + 1,
      selection: sharedSelection,
    }));

    const source = modelFor([], items, [], warnings);
    const beforeProjection = JSON.stringify(source.trajectory);
    Object.freeze(sharedSelection);
    for (const item of items) {
      Object.freeze(item);
    }
    Object.freeze(items);
    for (const warning of warnings) {
      Object.freeze(warning);
    }
    Object.freeze(warnings);

    const presentation = createAgentTrajectoryPresentation(source);

    expect(presentation.items.every((item) => item.warningGroups.length === 0)).toBe(true);
    expect(presentation.unattachedWarningGroups).toEqual([{ warning: warnings[0], count }]);
    expect(presentation.summary.warningCount).toBe(count);
    expect(presentation.items[0]).not.toHaveProperty("warnings");
    expect(JSON.stringify(source.trajectory)).toBe(beforeProjection);
  });

  it("groups 5,005 uniquely attached warnings by kind", () => {
    const count = 5_005;
    const selection = selectionFor("grouped-attached");
    const item = toolItemFor("grouped-attached-tool", "running", { callSelection: selection });
    const warnings: AgentTrajectoryWarning[] = Array.from({ length: count }, (_, index) => ({
      kind: "unpaired-tool-call",
      recordId: selection.recordId,
      lineNumber: index + 1,
      selection,
    }));

    const presentation = createAgentTrajectoryPresentation(modelFor([], [item], [], warnings));

    expect(presentation.items[0]?.warningGroups).toEqual([{ warning: warnings[0], count }]);
    expect(presentation.unattachedWarningGroups).toEqual([]);
    expect(presentation.summary.warningCount).toBe(count);
  });

  it("keeps opaque warning call ids exact, including whitespace", () => {
    const sharedCallSelection = selectionFor("opaque-call-evidence");
    const paddedCall = toolItemFor("opaque-padded", "running", {
      callId: " call-1 ",
      callSelection: sharedCallSelection,
    });
    const blankCall = toolItemFor("opaque-blank", "running", {
      callId: " ",
      callSelection: sharedCallSelection,
    });
    const warnings: AgentTrajectoryWarning[] = [
      {
        kind: "unpaired-tool-call",
        callId: " call-1 ",
        recordId: sharedCallSelection.recordId,
        lineNumber: paddedCall.lineNumber,
        selection: sharedCallSelection,
      },
      {
        kind: "unpaired-tool-call",
        callId: " ",
        recordId: sharedCallSelection.recordId,
        lineNumber: blankCall.lineNumber,
        selection: sharedCallSelection,
      },
    ];

    const presentation = createAgentTrajectoryPresentation(
      modelFor([], [paddedCall, blankCall], [], warnings),
    );

    expect(presentation.items.map((item) => item.warningGroups)).toEqual([
      warningGroupsFor([warnings[0]!]),
      warningGroupsFor([warnings[1]!]),
    ]);
  });

  it("keeps delimiter-containing canonical selections isolated for one call id", () => {
    const firstSelection: AgentCanonicalSelection = {
      kind: "event",
      recordId: "record\u0000fragment",
      id: "tail",
    };
    const secondSelection: AgentCanonicalSelection = {
      kind: "event",
      recordId: "record",
      id: "fragment\u0000tail",
    };
    const first = toolItemFor("nul-first", "running", {
      callId: "shared-call",
      callSelection: firstSelection,
    });
    const second = toolItemFor("nul-second", "running", {
      callId: "shared-call",
      callSelection: secondSelection,
    });
    const warning = {
      kind: "unpaired-tool-call",
      callId: "shared-call",
      recordId: secondSelection.recordId,
      lineNumber: 91,
      selection: secondSelection,
    } satisfies AgentTrajectoryWarning;

    const presentation = createAgentTrajectoryPresentation(
      modelFor([], [first, second], [], [warning]),
    );

    expect(presentation.items.map((item) => item.warningGroups)).toEqual([
      [],
      warningGroupsFor([warning]),
    ]);
  });

  it("keeps record, event, and conversation selections exact with quotes and NUL characters", () => {
    const selections: readonly AgentCanonicalSelection[] = [
      { kind: "record", recordId: 'record"\u0000id' },
      { kind: "event", recordId: 'event"\u0000record', id: 'event"\u0000id' },
      {
        kind: "conversation",
        recordId: 'conversation"\u0000record',
        id: 'conversation"\u0000id',
      },
    ];
    const callIds = ["call-record", "call-event", "call-conversation"] as const;
    const items = selections.map((selection, index) =>
      toolItemFor(`escaped-${index}`, "running", {
        callId: callIds[index]!,
        callSelection: selection,
      }),
    );
    const warnings: AgentTrajectoryWarning[] = selections.map((selection, index) => ({
      kind: "unpaired-tool-call",
      callId: callIds[index]!,
      recordId: selection.recordId,
      lineNumber: 100 + index,
      selection,
    }));

    const presentation = createAgentTrajectoryPresentation(modelFor([], items, [], warnings));

    expect(presentation.items.map((item) => item.warningGroups)).toEqual(
      warnings.map((warning) => [{ warning, count: 1 }]),
    );
  });

  it("uses call, result, and completion selections as warning candidates", () => {
    const call = selectionFor("call-evidence-2");
    const result = selectionFor("result-evidence-2");
    const completion = selectionFor("completion-evidence-2");
    const item = toolItemFor("tool-evidence-2", "failed", {
      callId: "call-evidence-2",
      callSelection: call,
      resultSelection: result,
      completionSelection: completion,
    });
    const warnings = [
      {
        kind: "unpaired-tool-call",
        callId: "call-evidence-2",
        recordId: call.recordId,
        lineNumber: 1,
        selection: call,
      } satisfies AgentTrajectoryWarning,
      {
        kind: "unpaired-tool-result",
        callId: "call-evidence-2",
        recordId: result.recordId,
        lineNumber: 2,
        selection: result,
      } satisfies AgentTrajectoryWarning,
      {
        kind: "unpaired-tool-completion",
        callId: "call-evidence-2",
        recordId: completion.recordId,
        lineNumber: 3,
        selection: completion,
      } satisfies AgentTrajectoryWarning,
    ];
    const presentation = createAgentTrajectoryPresentation(
      modelFor(
        [
          eventFor("tool-evidence-2", "Tool", ""),
          eventFor("call-evidence-2", "Call", ""),
          eventFor("result-evidence-2", "Result", ""),
          eventFor("completion-evidence-2", "Completion", ""),
        ],
        [item],
        [],
        warnings,
      ),
    );

    expect(presentation.items[0]?.warningGroups).toEqual(warningGroupsFor(warnings));
  });

  it("groups every shared warning kind without attaching it to a different tool", () => {
    const sharedSelection = selectionFor("shared-warning-evidence");
    const tool = toolItemFor("grouped-warning-tool", "running", {
      callId: "call-attached",
      callSelection: sharedSelection,
    });
    const terminalSelection = selectionFor("terminal-warning-evidence");
    const attachedWarning = {
      kind: "unpaired-tool-call",
      callId: "call-attached",
      recordId: sharedSelection.recordId,
      lineNumber: 69,
      selection: sharedSelection,
    } satisfies AgentTrajectoryWarning;
    const unmatchedCallWarning = {
      kind: "unpaired-tool-call",
      callId: "call-unmatched",
      recordId: sharedSelection.recordId,
      lineNumber: 70,
      selection: sharedSelection,
    } satisfies AgentTrajectoryWarning;
    const warningsForEveryKind = agentTrajectoryWarningKinds.map((kind, index) =>
      kind === "unpaired-tool-call"
        ? unmatchedCallWarning
        : warningForKind(kind, 71 + index, terminalSelection),
    );
    const warnings: readonly AgentTrajectoryWarning[] = [
      attachedWarning,
      ...warningsForEveryKind,
      {
        kind: "unpaired-tool-call",
        callId: "call-unmatched-second",
        recordId: terminalSelection.recordId,
        lineNumber: 82,
        selection: terminalSelection,
      },
    ];
    const source = modelFor(
      [
        eventFor("grouped-warning-tool", "Tool", ""),
        eventFor("shared-warning-evidence", "Call", ""),
        eventFor("terminal-warning-evidence", "Terminal", ""),
      ],
      [tool],
      [turnFor("turn-1", [tool])],
      warnings,
    );
    const beforeProjection = JSON.stringify(source.trajectory);
    Object.freeze(tool);
    Object.freeze(source.trajectory.items);
    Object.freeze(source.trajectory.turns);
    for (const warning of warnings) {
      Object.freeze(warning);
    }
    Object.freeze(source.trajectory.warnings);

    const presentation = createAgentTrajectoryPresentation(source);

    expect(presentation.items[0]?.warningGroups).toEqual(warningGroupsFor([attachedWarning]));
    expect(Object.isFrozen(agentTrajectoryWarningKinds)).toBe(true);
    expect(presentation.unattachedWarningGroups).toHaveLength(agentTrajectoryWarningKinds.length);
    expect(presentation.unattachedWarningGroups.map((group) => group.warning.kind)).toEqual(
      agentTrajectoryWarningKinds,
    );
    expect(presentation.unattachedWarningGroups.map((group) => group.count)).toEqual(
      agentTrajectoryWarningKinds.map((kind) => (kind === "unpaired-tool-call" ? 2 : 1)),
    );
    expect(
      presentation.unattachedWarningGroups.find(
        (group) => group.warning.kind === "unpaired-tool-call",
      ),
    ).toEqual({
      warning: unmatchedCallWarning,
      count: 2,
    });
    expect(
      presentation.unattachedWarningGroups.find(
        (group) => group.warning.kind === "reversed-timestamp",
      )?.warning.selection,
    ).toBe(terminalSelection);
    expect(presentation.summary.warningCount).toBe(warnings.length);
    expect(JSON.stringify(source.trajectory)).toBe(beforeProjection);
  });

  it("keeps a reversed terminal lifecycle warning unattached to the preceding item", () => {
    const session = {
      fileType: "Codex",
      meta: { turnCount: 1 },
      parseWarnings: [],
      parseWarningCount: 0,
      events: [
        {
          ...eventFor("lifecycle-start", "Start", ""),
          timestamp: 20,
          trajectoryEvidence: [{ kind: "turn-lifecycle", phase: "start", turnId: "turn-1" }],
        },
        {
          ...eventFor("lifecycle-item", "Item", ""),
          timestamp: 30,
          trajectoryEvidence: [{ kind: "model-output", role: "assistant", turnId: "turn-1" }],
        },
        {
          ...eventFor("lifecycle-terminal", "Terminal", ""),
          timestamp: 10,
          trajectoryEvidence: [{ kind: "turn-lifecycle", phase: "complete", turnId: "turn-1" }],
        },
      ],
    } satisfies AgentSession;
    const trajectory = createAgentTrajectoryModel(session);
    const presentation = createAgentTrajectoryPresentation(
      modelFor(session.events, trajectory.items, trajectory.turns, trajectory.warnings),
    );
    const reversedWarning = trajectory.warnings.find(
      (warning) => warning.kind === "reversed-timestamp" && warning.subject === "turn",
    );

    expect(reversedWarning).toBeDefined();
    expect(presentation.items).toHaveLength(1);
    expect(presentation.items[0]?.warningGroups).not.toContainEqual({
      warning: reversedWarning,
      count: 1,
    });
    expect(presentation.unattachedWarningGroups).toContainEqual({
      warning: reversedWarning,
      count: 1,
    });
  });

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

describe("filterAgentTrajectoryPresentation", () => {
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

describe("trajectory overview", () => {
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

describe("presentation input ownership", () => {
  it("does not modify readonly trajectory facts or search their collections repeatedly", () => {
    const item = modelOutputItemFor("event-40", "assistant", 10);
    const turn = turnFor("turn-readonly", [item], { startedAt: 0, endedAt: 20, durationMs: 20 });
    const base = modelFor([eventFor("event-40", "Readonly", "")], [item], [turn]);
    const guardedItems = new Proxy(base.trajectory.items, {
      get(target, property, receiver) {
        if (property === "find" || property === "filter") {
          throw new Error(`Unexpected item collection search: ${String(property)}`);
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const guardedTurns = new Proxy(base.trajectory.turns, {
      get(target, property, receiver) {
        if (property === "find" || property === "filter") {
          throw new Error(`Unexpected turn collection search: ${String(property)}`);
        }
        return Reflect.get(target, property, receiver);
      },
    });
    Object.freeze(item.selection);
    Object.freeze(item);
    Object.freeze(turn.items);
    Object.freeze(turn);
    Object.freeze(base.trajectory.warnings);
    Object.freeze(base.trajectory);
    const model = {
      ...base,
      trajectory: {
        ...base.trajectory,
        items: guardedItems,
        turns: guardedTurns,
      },
    } satisfies AgentSessionModel;

    const presentation = createAgentTrajectoryPresentation(model);

    expect(presentation.items[0]?.item).toBe(item);
    expect(base.trajectory.items).toEqual([item]);
    expect(base.trajectory.turns).toEqual([turn]);
  });
});
