import { describe, expect, expectTypeOf, it } from "vitest";
import {
  createAgentSessionModel,
  createAgentTrajectoryModel,
  type AgentConversationItem,
  type AgentDetailSelection,
  type AgentTokenUsageEvidence,
  type AgentTrajectoryEvidence,
  type AgentTrajectoryAssistantReasoningItem,
  type AgentTrajectoryItem,
  type AgentTrajectoryModel,
  type AgentTrajectorySystemItem,
  type AgentTrajectoryToolItem,
  type AgentTrajectoryUserItem,
  type AgentTrajectoryWarning,
  type AgentTimelineEvent,
  type AgentSession,
} from "../src/lib/agent-session";

interface EventOptions {
  timestamp?: number;
  turnIndex?: number;
  trajectoryEvidence?: readonly AgentTrajectoryEvidence[];
  conversationItems?: AgentConversationItem[];
}

const event = (
  id: string,
  recordId: string,
  lineNumber: number,
  options: EventOptions = {},
): AgentTimelineEvent => ({
  id,
  recordId,
  lineNumber,
  category: "assistant",
  kind: "event",
  label: id,
  preview: "",
  conversationItems: options.conversationItems ?? [],
  ...(options.timestamp === undefined ? {} : { timestamp: options.timestamp }),
  ...(options.turnIndex === undefined ? {} : { turnIndex: options.turnIndex }),
  ...(options.trajectoryEvidence === undefined
    ? {}
    : { trajectoryEvidence: options.trajectoryEvidence }),
});

const session = (events: AgentTimelineEvent[]): AgentSession => ({
  fileType: "Codex",
  meta: { turnCount: 0 },
  events,
  parseWarnings: [],
  parseWarningCount: 0,
});

const conversation = (id: string, role: AgentConversationItem["role"]): AgentConversationItem => ({
  id,
  role,
});

const lifecycle = (
  turnId: string,
  phase: "start" | "complete" | "failed" | "aborted",
): AgentTrajectoryEvidence => ({ kind: "turn-lifecycle", turnId, phase });

const modelOutput = (
  role: "user" | "assistant" | "reasoning" | "system",
  conversationItemId?: string,
): AgentTrajectoryEvidence => ({
  kind: "model-output",
  role,
  ...(conversationItemId === undefined ? {} : { conversationItemId }),
});

const toolCall = (
  toolName: string,
  callId?: string,
  conversationItemId?: string,
): AgentTrajectoryEvidence => ({
  kind: "tool-lifecycle",
  phase: "call",
  toolName,
  ...(callId === undefined ? {} : { callId }),
  ...(conversationItemId === undefined ? {} : { conversationItemId }),
});

const toolResult = (
  status: "completed" | "failed",
  callId?: string,
  durationMs?: number,
  conversationItemId?: string,
): AgentTrajectoryEvidence => ({
  kind: "tool-lifecycle",
  phase: "result",
  status,
  ...(callId === undefined ? {} : { callId }),
  ...(durationMs === undefined ? {} : { durationMs }),
  ...(conversationItemId === undefined ? {} : { conversationItemId }),
});

const unknownToolResult = (callId?: string): AgentTrajectoryEvidence =>
  ({
    kind: "tool-lifecycle",
    phase: "result",
    ...(callId === undefined ? {} : { callId }),
  }) satisfies AgentTrajectoryEvidence;

const toolCompletion = (
  status: "completed" | "failed",
  callId?: string,
  durationMs?: number,
): AgentTrajectoryEvidence =>
  ({
    kind: "tool-lifecycle",
    phase: "completion",
    status,
    ...(callId === undefined ? {} : { callId }),
    ...(durationMs === undefined ? {} : { durationMs }),
  }) satisfies AgentTrajectoryEvidence;

const tokenUsage = (usage: Record<string, number>, turnId?: string): AgentTrajectoryEvidence => ({
  kind: "token-usage",
  usage,
  ...(turnId === undefined ? {} : { turnId }),
});

const tokenUsageWithCumulative = (
  usage: Record<string, number>,
  cumulativeUsage: Record<string, number>,
  turnId?: string,
): AgentTokenUsageEvidence => ({
  kind: "token-usage",
  usage,
  cumulativeUsage,
  ...(turnId === undefined ? {} : { turnId }),
});

const cumulativeTokenUsage = (
  cumulativeUsage: Record<string, number>,
  turnId?: string,
): AgentTokenUsageEvidence => ({
  kind: "token-usage",
  cumulativeUsage,
  ...(turnId === undefined ? {} : { turnId }),
});

const itemById = (
  model: AgentTrajectoryModel,
  id: string,
): AgentTrajectoryAssistantReasoningItem => {
  for (const item of model.items) {
    if (item.id === id && (item.kind === "assistant" || item.kind === "reasoning")) {
      return item;
    }
  }
  throw new Error(`Missing trajectory item ${id}`);
};

const userItemById = (model: AgentTrajectoryModel, id: string): AgentTrajectoryUserItem => {
  for (const item of model.items) {
    if (item.id === id && item.kind === "user") {
      return item;
    }
  }
  throw new Error(`Missing user trajectory item ${id}`);
};

const toolItems = (model: AgentTrajectoryModel) => {
  const items: Extract<AgentTrajectoryItem, { kind: "tool" }>[] = [];
  for (const item of model.items) {
    if (item.kind === "tool") {
      items.push(item);
    }
  }
  return items;
};

const warningKinds = (model: AgentTrajectoryModel) => {
  const kinds: string[] = [];
  for (const warning of model.warnings) {
    kinds.push(warning.kind);
  }
  return kinds;
};

const trajectoryTurnId = (
  source: "evidence" | "fallback-index" | "synthetic-event",
  value: string | number,
) => JSON.stringify([source, value]);

const assertTrajectoryOutputIsReadonly = (model: AgentTrajectoryModel) => {
  // @ts-expect-error Trajectory turns are an immutable public result.
  model.turns = [];
  // @ts-expect-error Trajectory statistics are an immutable public result.
  model.stats = { tokenUsage: {} };

  const turn = model.turns[0];
  if (turn) {
    // @ts-expect-error A projected turn cannot be rewritten.
    turn.status = "completed";
  }

  const item = model.items[0];
  if (item) {
    // @ts-expect-error A projected item cannot replace its selection.
    item.selection = { kind: "record", recordId: "replacement" };
    // @ts-expect-error A projected selection cannot be rewritten.
    item.selection.recordId = "replacement";
  }

  const modelOutputItem = model.items.find(
    (item): item is AgentTrajectoryAssistantReasoningItem =>
      item.kind === "assistant" || item.kind === "reasoning",
  );
  if (modelOutputItem?.tokenUsage) {
    // @ts-expect-error A projected item token snapshot cannot be rewritten.
    modelOutputItem.tokenUsage.inputTokens = 1;
    // @ts-expect-error A projected item reasoning token snapshot cannot be rewritten.
    modelOutputItem.tokenUsage.reasoningOutputTokens = 1;
  }
  const toolItem = model.items.find(
    (item): item is Extract<AgentTrajectoryItem, { kind: "tool" }> => item.kind === "tool",
  );
  if (toolItem) {
    // @ts-expect-error A projected tool completion cannot be rewritten.
    toolItem.completionSelection = { kind: "record", recordId: "replacement" };
  }
  // @ts-expect-error A projected aggregate token snapshot cannot be rewritten.
  model.stats.tokenUsage.outputTokens = 1;
  // @ts-expect-error A projected aggregate reasoning token snapshot cannot be rewritten.
  model.stats.tokenUsage.reasoningOutputTokens = 1;

  const warning = model.warnings[0];
  if (warning) {
    // @ts-expect-error A projected warning cannot be rewritten.
    warning.lineNumber = 0;
    // @ts-expect-error A warning selection cannot be rewritten.
    warning.selection.recordId = "replacement";
  }
};

void assertTrajectoryOutputIsReadonly;

const assertTrajectorySelectionsCannotNest = () => {
  const trajectorySelection = {
    kind: "trajectory",
    id: "trajectory-item",
    recordId: "record-trajectory",
  } satisfies AgentDetailSelection;
  const canonicalSelection = {
    kind: "event",
    id: "event-1",
    recordId: "record-1",
  } as const;

  const item: AgentTrajectoryUserItem = {
    id: "item-1",
    kind: "user",
    status: "completed",
    recordId: "record-1",
    lineNumber: 1,
    // @ts-expect-error A trajectory item must resolve through a canonical selection.
    selection: trajectorySelection,
  };
  const tool: AgentTrajectoryToolItem = {
    id: "tool-1",
    kind: "tool",
    status: "completed",
    recordId: "record-1",
    lineNumber: 1,
    selection: canonicalSelection,
    // @ts-expect-error A tool call must resolve through a canonical selection.
    callSelection: trajectorySelection,
    // @ts-expect-error A tool result must resolve through a canonical selection.
    resultSelection: trajectorySelection,
    // @ts-expect-error A tool completion must resolve through a canonical selection.
    completionSelection: trajectorySelection,
  };
  const warning: AgentTrajectoryWarning = {
    kind: "unpaired-tool-call",
    recordId: "record-1",
    lineNumber: 1,
    // @ts-expect-error A warning must resolve through a canonical selection.
    selection: trajectorySelection,
  };

  void item;
  void tool;
  void warning;
};

void assertTrajectorySelectionsCannotNest;

describe("createAgentTrajectoryModel", () => {
  it("keeps projected selections canonical when trajectory tokens are available", () => {
    const output = conversation("output-1", "assistant");
    const source = session([
      event("event-1", "record-1", 1, {
        conversationItems: [output],
        trajectoryEvidence: [modelOutput("assistant", output.id)],
      }),
    ]);
    const projected = createAgentTrajectoryModel(source);
    const model = createAgentSessionModel(source);

    expect(model.trajectory).toEqual(projected);
    expect(projected.items[0]?.selection).toEqual({
      kind: "conversation",
      id: "output-1",
      recordId: "record-1",
    });
    expect(projected.items[0]).not.toHaveProperty("label");
    expect(projected.items[0]).not.toHaveProperty("preview");
    expect(model.selectTrajectory("event-1:evidence-0")).toEqual({
      kind: "trajectory",
      id: "event-1:evidence-0",
      recordId: "record-1",
    });
  });

  it("requires at least one token evidence source", () => {
    const cumulativeOnly = {
      kind: "token-usage",
      cumulativeUsage: { inputTokens: 1 },
    } satisfies AgentTokenUsageEvidence;
    expectTypeOf(cumulativeOnly).toMatchTypeOf<AgentTokenUsageEvidence>();

    // @ts-expect-error Token evidence requires incremental or cumulative usage.
    const withoutSources: AgentTokenUsageEvidence = { kind: "token-usage" };
    expect(withoutSources.kind).toBe("token-usage");
  });

  it("keeps user items free of assistant recovery and token fields", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("user-output", "record-user-output", 1, {
          trajectoryEvidence: [modelOutput("user")],
        }),
      ]),
    );
    const user = model.items[0];
    if (!user || user.kind !== "user") {
      throw new Error("Missing user trajectory item");
    }

    expect("step" in user).toBe(false);
    expect("tokenUsage" in user).toBe(false);
    expectTypeOf(user).toEqualTypeOf<AgentTrajectoryUserItem>();
  });

  it("projects system output without becoming a token or derived-step anchor", () => {
    const initialAssistant = conversation("initial-assistant", "assistant");
    const systemOutput = conversation("system-output", "system");
    const recoveredAssistant = conversation("recovered-assistant", "assistant");
    const source = session([
      event("initial-assistant", "record-initial-assistant", 1, {
        turnIndex: 1,
        conversationItems: [initialAssistant],
        trajectoryEvidence: [
          { ...modelOutput("assistant", initialAssistant.id), turnId: "turn-system-output" },
        ],
      }),
      event("tool-call", "record-tool-call", 2, {
        turnIndex: 1,
        trajectoryEvidence: [
          { ...toolCall("read_file", "call-system-output"), turnId: "turn-system-output" },
        ],
      }),
      event("tool-result", "record-tool-result", 3, {
        turnIndex: 1,
        trajectoryEvidence: [
          {
            ...toolResult("completed", "call-system-output"),
            turnId: "turn-system-output",
          },
        ],
      }),
      event("system-output", "record-system-output", 4, {
        turnIndex: 1,
        conversationItems: [systemOutput],
        trajectoryEvidence: [
          { ...modelOutput("system", systemOutput.id), turnId: "turn-system-output" },
        ],
      }),
      event("token-usage", "record-token-usage", 5, {
        turnIndex: 1,
        trajectoryEvidence: [tokenUsage({ inputTokens: 3 }, "turn-system-output")],
      }),
      event("recovered-assistant", "record-recovered-assistant", 6, {
        turnIndex: 1,
        conversationItems: [recoveredAssistant],
        trajectoryEvidence: [
          {
            ...modelOutput("assistant", recoveredAssistant.id),
            turnId: "turn-system-output",
          },
        ],
      }),
    ]);

    const trajectory = createAgentTrajectoryModel(source);
    const canonical = createAgentSessionModel(source);
    const system = trajectory.items.find(
      (item): item is AgentTrajectorySystemItem => item.kind === "system",
    );

    expect(system).toMatchObject({
      id: "system-output:evidence-0",
      status: "completed",
      recordId: "record-system-output",
      selection: {
        kind: "conversation",
        id: "system-output",
        recordId: "record-system-output",
      },
    });
    expect(system).toBeDefined();
    if (!system) {
      throw new Error("Missing system trajectory item");
    }
    expect("step" in system).toBe(false);
    expect("tokenUsage" in system).toBe(false);
    expectTypeOf(system).toEqualTypeOf<AgentTrajectorySystemItem>();
    expect(itemById(trajectory, "initial-assistant:evidence-0").tokenUsage).toEqual({
      inputTokens: 3,
    });
    expect(itemById(trajectory, "recovered-assistant:evidence-0").step).toEqual({
      index: 1,
      source: "derived",
    });
    expect(canonical.resolveDetail(system.selection)?.recordId).toBe("record-system-output");
    expect(canonical.selectTrajectory(system.id)).toEqual({
      kind: "trajectory",
      id: system.id,
      recordId: "record-system-output",
    });
  });

  it("projects ordered lifecycle turns with their terminal states", () => {
    const firstUser = conversation("first-user", "user");
    const firstAssistant = conversation("first-assistant", "assistant");
    const secondReasoning = conversation("second-reasoning", "thinking");
    const model = createAgentTrajectoryModel(
      session([
        event("start-one", "opaque/one/start", 11, {
          timestamp: 10,
          turnIndex: 1,
          trajectoryEvidence: [lifecycle("turn-one", "start")],
        }),
        event("user-one", "opaque/one/user", 12, {
          timestamp: 12,
          turnIndex: 1,
          conversationItems: [firstUser],
          trajectoryEvidence: [{ ...modelOutput("user", firstUser.id), turnId: "turn-one" }],
        }),
        event("assistant-one", "opaque/one/assistant", 13, {
          timestamp: 20,
          turnIndex: 1,
          conversationItems: [firstAssistant],
          trajectoryEvidence: [
            { ...modelOutput("assistant", firstAssistant.id), turnId: "turn-one" },
          ],
        }),
        event("complete-one", "opaque/one/complete", 14, {
          timestamp: 30,
          turnIndex: 1,
          trajectoryEvidence: [lifecycle("turn-one", "complete")],
        }),
        event("start-two", "opaque/two/start", 21, {
          timestamp: 40,
          turnIndex: 2,
          trajectoryEvidence: [lifecycle("turn-two", "start")],
        }),
        event("reasoning-two", "opaque/two/reasoning", 22, {
          timestamp: 50,
          turnIndex: 2,
          conversationItems: [secondReasoning],
          trajectoryEvidence: [
            { ...modelOutput("reasoning", secondReasoning.id), turnId: "turn-two" },
          ],
        }),
        event("failed-two", "opaque/two/failed", 23, {
          timestamp: 70,
          turnIndex: 2,
          trajectoryEvidence: [lifecycle("turn-two", "failed")],
        }),
      ]),
    );

    expect(
      model.turns.map(({ id, status, turnIndex, startedAt, endedAt, durationMs }) => ({
        id,
        status,
        turnIndex,
        startedAt,
        endedAt,
        durationMs,
      })),
    ).toEqual([
      {
        id: trajectoryTurnId("evidence", "turn-one"),
        status: "completed",
        turnIndex: 1,
        startedAt: 10,
        endedAt: 30,
        durationMs: 20,
      },
      {
        id: trajectoryTurnId("evidence", "turn-two"),
        status: "failed",
        turnIndex: 2,
        startedAt: 40,
        endedAt: 70,
        durationMs: 30,
      },
    ]);
    expect(
      model.items.filter((item) => item.turnId === model.turns[0]?.id).map((item) => item.id),
    ).toEqual(["user-one:evidence-0", "assistant-one:evidence-0"]);
    expect(
      model.items.filter((item) => item.turnId === model.turns[1]?.id).map((item) => item.id),
    ).toEqual(["reasoning-two:evidence-0"]);
  });

  it("uses explicit turn ids before a shared display turn index", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("first-start", "record-first-start", 1, {
          turnIndex: 1,
          trajectoryEvidence: [lifecycle("first-turn", "start")],
        }),
        event("second-start", "record-second-start", 2, {
          turnIndex: 1,
          trajectoryEvidence: [lifecycle("second-turn", "start")],
        }),
        event("first-complete", "record-first-complete", 3, {
          turnIndex: 1,
          trajectoryEvidence: [lifecycle("first-turn", "complete")],
        }),
        event("second-failed", "record-second-failed", 4, {
          turnIndex: 1,
          trajectoryEvidence: [lifecycle("second-turn", "failed")],
        }),
      ]),
    );

    expect(model.turns.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: trajectoryTurnId("evidence", "first-turn"), status: "completed" },
      { id: trajectoryTurnId("evidence", "second-turn"), status: "failed" },
    ]);
  });

  it("keeps a fallback-index turn distinct from an explicit id with the old fallback text", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("fallback-index", "record-fallback-index", 1, {
          turnIndex: 1,
          trajectoryEvidence: [modelOutput("assistant")],
        }),
        event("explicit-id", "record-explicit-id", 2, {
          turnIndex: 2,
          trajectoryEvidence: [lifecycle("turn-1", "start")],
        }),
      ]),
    );

    expect(model.turns.map((turn) => turn.id)).toEqual([
      '["fallback-index",1]',
      '["evidence","turn-1"]',
    ]);
  });

  it("keeps a synthetic-event turn distinct from an explicit id with the old synthetic text", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("synthetic-start", "record-synthetic-start", 1, {
          trajectoryEvidence: [{ kind: "turn-lifecycle", phase: "start" }],
        }),
        event("explicit-id", "record-explicit-id", 2, {
          trajectoryEvidence: [lifecycle("event:synthetic-start", "start")],
        }),
      ]),
    );

    expect(model.turns.map((turn) => turn.id)).toEqual([
      '["synthetic-event","synthetic-start"]',
      '["evidence","event:synthetic-start"]',
    ]);
  });

  it("keeps an index fallback separate from explicit evidence with the same display index", () => {
    const firstAssistant = conversation("fallback-first", "assistant");
    const secondAssistant = conversation("fallback-second", "assistant");
    const model = createAgentTrajectoryModel(
      session([
        event("fallback-first", "record-fallback-first", 1, {
          turnIndex: 1,
          conversationItems: [firstAssistant],
          trajectoryEvidence: [modelOutput("assistant", firstAssistant.id)],
        }),
        event("actual-start", "record-actual-start", 2, {
          turnIndex: 1,
          trajectoryEvidence: [lifecycle("actual", "start")],
        }),
        event("fallback-second", "record-fallback-second", 3, {
          turnIndex: 1,
          conversationItems: [secondAssistant],
          trajectoryEvidence: [modelOutput("assistant", secondAssistant.id)],
        }),
        event("actual-complete", "record-actual-complete", 4, {
          turnIndex: 1,
          trajectoryEvidence: [lifecycle("actual", "complete")],
        }),
      ]),
    );

    expect(model.turns).toMatchObject([
      { id: trajectoryTurnId("fallback-index", 1), status: "running" },
      { id: trajectoryTurnId("evidence", "actual"), status: "completed" },
    ]);
    expect(
      model.items.filter((item) => item.turnId === model.turns[0]?.id).map((item) => item.id),
    ).toEqual(["fallback-first:evidence-0", "fallback-second:evidence-0"]);
  });

  it("keeps token, tool, and recovery state across explicit evidence", () => {
    const initial = conversation("promoted-initial", "assistant");
    const recovered = conversation("promoted-recovered", "assistant");
    const model = createAgentTrajectoryModel(
      session([
        event("promoted-initial", "record-promoted-initial", 1, {
          timestamp: 10,
          turnIndex: 1,
          conversationItems: [initial],
          trajectoryEvidence: [{ ...modelOutput("assistant", initial.id), turnId: "promoted" }],
        }),
        event("promoted-token", "record-promoted-token", 2, {
          turnIndex: 1,
          trajectoryEvidence: [tokenUsage({ inputTokens: 4 }, "promoted")],
        }),
        event("promoted-call", "record-promoted-call", 3, {
          timestamp: 20,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCall("shell", "promoted-call"), turnId: "promoted" }],
        }),
        event("promoted-start", "record-promoted-start", 4, {
          timestamp: 25,
          turnIndex: 1,
          trajectoryEvidence: [lifecycle("promoted", "start")],
        }),
        event("promoted-result", "record-promoted-result", 5, {
          timestamp: 30,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolResult("completed", "promoted-call"), turnId: "promoted" }],
        }),
        event("promoted-recovered", "record-promoted-recovered", 6, {
          timestamp: 35,
          turnIndex: 1,
          conversationItems: [recovered],
          trajectoryEvidence: [{ ...modelOutput("assistant", recovered.id), turnId: "promoted" }],
        }),
        event("promoted-complete", "record-promoted-complete", 7, {
          timestamp: 40,
          turnIndex: 1,
          trajectoryEvidence: [lifecycle("promoted", "complete")],
        }),
      ]),
    );

    expect(model.turns).toMatchObject([
      { id: trajectoryTurnId("evidence", "promoted"), status: "completed" },
    ]);
    expect(itemById(model, "promoted-initial:evidence-0").tokenUsage).toEqual({
      inputTokens: 4,
    });
    expect(toolItems(model)).toMatchObject([
      {
        callId: "promoted-call",
        status: "completed",
        startedAt: 20,
        endedAt: 30,
      },
    ]);
    expect(itemById(model, "promoted-recovered:evidence-0").step).toEqual({
      index: 1,
      source: "derived",
    });
  });

  it("does not attach later index-only facts to conflicting explicit turn ids", () => {
    const unscoped = conversation("ambiguous-index-output", "assistant");
    const model = createAgentTrajectoryModel(
      session([
        event("first-explicit", "record-first-explicit", 1, {
          turnIndex: 1,
          trajectoryEvidence: [lifecycle("first", "start")],
        }),
        event("second-explicit", "record-second-explicit", 2, {
          turnIndex: 1,
          trajectoryEvidence: [lifecycle("second", "start")],
        }),
        event("ambiguous-index-output", "record-ambiguous-index-output", 3, {
          turnIndex: 1,
          conversationItems: [unscoped],
          trajectoryEvidence: [modelOutput("assistant", unscoped.id)],
        }),
      ]),
    );

    expect(
      model.turns.map((turn) => ({
        id: turn.id,
        itemCount: model.items.filter((item) => item.turnId === turn.id).length,
      })),
    ).toEqual([
      { id: trajectoryTurnId("evidence", "first"), itemCount: 0 },
      { id: trajectoryTurnId("evidence", "second"), itemCount: 0 },
      { id: trajectoryTurnId("fallback-index", 1), itemCount: 1 },
    ]);
  });

  it("keeps an unterminated turn running and reports its source", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("open-start", "record-open-start", 1, {
          timestamp: 10,
          turnIndex: 1,
          trajectoryEvidence: [lifecycle("open-turn", "start")],
        }),
      ]),
    );

    expect(model.turns).toMatchObject([
      { id: trajectoryTurnId("evidence", "open-turn"), status: "running", startedAt: 10 },
    ]);
    expect(model.warnings).toEqual(
      expect.arrayContaining([
        {
          kind: "open-turn",
          turnId: "open-turn",
          recordId: "record-open-start",
          lineNumber: 1,
          turnIndex: 1,
          selection: { kind: "event", id: "open-start", recordId: "record-open-start" },
        },
      ]),
    );
  });

  it("isolates matching call ids by turn identity", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("one-call", "record-one-call", 1, {
          timestamp: 10,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCall("first-tool", "same-call"), turnId: "turn-one" }],
        }),
        event("two-call", "record-two-call", 2, {
          timestamp: 20,
          turnIndex: 2,
          trajectoryEvidence: [{ ...toolCall("second-tool", "same-call"), turnId: "turn-two" }],
        }),
        event("two-result", "record-two-result", 3, {
          timestamp: 25,
          turnIndex: 2,
          trajectoryEvidence: [{ ...toolResult("failed", "same-call"), turnId: "turn-two" }],
        }),
        event("one-result", "record-one-result", 4, {
          timestamp: 35,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolResult("completed", "same-call"), turnId: "turn-one" }],
        }),
      ]),
    );

    expect(
      toolItems(model).map(({ toolName, callId, status, durationMs }) => ({
        toolName,
        callId,
        status,
        durationMs,
      })),
    ).toEqual([
      { toolName: "first-tool", callId: "same-call", status: "completed", durationMs: 25 },
      { toolName: "second-tool", callId: "same-call", status: "failed", durationMs: 5 },
    ]);
  });

  it("pairs an explicit turn across inconsistent display indexes", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("identity-call", "record-identity-call", 1, {
          timestamp: 10,
          turnIndex: 1,
          trajectoryEvidence: [
            { ...toolCall("identity-tool", "identity-call"), turnId: "identity-turn" },
          ],
        }),
        event("identity-result", "record-identity-result", 2, {
          timestamp: 25,
          turnIndex: 2,
          trajectoryEvidence: [
            { ...toolResult("completed", "identity-call"), turnId: "identity-turn" },
          ],
        }),
      ]),
    );

    expect(toolItems(model)).toMatchObject([
      {
        toolName: "identity-tool",
        status: "completed",
        startedAt: 10,
        endedAt: 25,
        durationMs: 15,
      },
    ]);
    expect(warningKinds(model)).not.toEqual(
      expect.arrayContaining(["unpaired-tool-call", "unpaired-tool-result"]),
    );
  });

  it("does not pair different explicit turns sharing a display index", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("first-identity-call", "record-first-identity-call", 1, {
          turnIndex: 1,
          trajectoryEvidence: [
            { ...toolCall("first-identity", "identity-conflict"), turnId: "first-identity" },
          ],
        }),
        event("second-identity-result", "record-second-identity-result", 2, {
          turnIndex: 1,
          trajectoryEvidence: [
            {
              ...toolResult("completed", "identity-conflict"),
              turnId: "second-identity",
            },
          ],
        }),
      ]),
    );

    expect(toolItems(model)).toHaveLength(2);
    expect(toolItems(model).every((item) => !(item.callSelection && item.resultSelection))).toBe(
      true,
    );
    expect(warningKinds(model)).toEqual(
      expect.arrayContaining(["unpaired-tool-call", "unpaired-tool-result"]),
    );
  });

  it("keeps completed, failed, and open tools distinct from the turn status", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("turn-start", "record-start", 1, {
          timestamp: 1,
          turnIndex: 1,
          trajectoryEvidence: [lifecycle("turn", "start")],
        }),
        event("done-call", "record-done-call", 2, {
          timestamp: 10,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCall("done", "done"), turnId: "turn" }],
        }),
        event("done-result", "record-done-result", 3, {
          timestamp: 15,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolResult("completed", "done"), turnId: "turn" }],
        }),
        event("failed-call", "record-failed-call", 4, {
          timestamp: 20,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCall("failed", "failed"), turnId: "turn" }],
        }),
        event("failed-result", "record-failed-result", 5, {
          timestamp: 25,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolResult("failed", "failed"), turnId: "turn" }],
        }),
        event("open-call", "record-open-call", 6, {
          timestamp: 30,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCall("open", "open"), turnId: "turn" }],
        }),
        event("turn-complete", "record-complete", 7, {
          timestamp: 40,
          turnIndex: 1,
          trajectoryEvidence: [lifecycle("turn", "complete")],
        }),
      ]),
    );

    expect(model.turns[0]?.status).toBe("completed");
    expect(toolItems(model).map((item) => item.status)).toEqual(["completed", "failed", "running"]);
    expect(model.stats).toEqual({ tokenUsage: {} });
    expect(warningKinds(model)).toContain("unpaired-tool-call");
  });

  it("keeps statusless tool results paired but running", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("unknown-call", "record-unknown-call", 1, {
          timestamp: 10,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCall("shell", "unknown"), turnId: "turn" }],
        }),
        event("unknown-result", "record-unknown-result", 2, {
          timestamp: 20,
          turnIndex: 1,
          trajectoryEvidence: [{ ...unknownToolResult("unknown"), turnId: "turn" }],
        }),
        event("orphan-unknown-result", "record-orphan-unknown-result", 3, {
          timestamp: 30,
          turnIndex: 1,
          trajectoryEvidence: [{ ...unknownToolResult("orphan"), turnId: "turn" }],
        }),
      ]),
    );

    expect(toolItems(model)).toMatchObject([
      {
        callId: "unknown",
        status: "running",
        startedAt: 10,
        endedAt: 20,
        durationMs: 10,
        callSelection: {
          kind: "event",
          id: "unknown-call",
          recordId: "record-unknown-call",
        },
        resultSelection: {
          kind: "event",
          id: "unknown-result",
          recordId: "record-unknown-result",
        },
      },
      {
        callId: "orphan",
        status: "running",
        resultSelection: {
          kind: "event",
          id: "orphan-unknown-result",
          recordId: "record-orphan-unknown-result",
        },
      },
    ]);
    expect(warningKinds(model)).toContain("unpaired-tool-result");
    expect(model.warnings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "unpaired-tool-result", callId: "unknown" }),
      ]),
    );
  });

  it("combines a call, result, and completion into one failed tool", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("triple-call", "record-triple-call", 1, {
          timestamp: 100,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCall("inspect", "triple"), turnId: "turn" }],
        }),
        event("triple-result", "record-triple-result", 2, {
          timestamp: 200,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolResult("completed", "triple"), turnId: "turn" }],
        }),
        event("triple-completion", "record-triple-completion", 3, {
          timestamp: 300,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCompletion("failed", "triple", 17), turnId: "turn" }],
        }),
      ]),
    );

    expect(toolItems(model)).toEqual([
      expect.objectContaining({
        status: "failed",
        selection: { kind: "event", id: "triple-call", recordId: "record-triple-call" },
        callSelection: { kind: "event", id: "triple-call", recordId: "record-triple-call" },
        resultSelection: { kind: "event", id: "triple-result", recordId: "record-triple-result" },
        completionSelection: {
          kind: "event",
          id: "triple-completion",
          recordId: "record-triple-completion",
        },
        startedAt: 100,
        endedAt: 300,
        durationMs: 17,
      }),
    ]);
  });

  it("combines unique result and completion evidence without a call once", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("orphan-result", "record-orphan-result", 1, {
          timestamp: 20,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolResult("completed", "orphan"), turnId: "turn" }],
        }),
        event("orphan-completion", "record-orphan-completion", 2, {
          timestamp: 30,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCompletion("failed", "orphan", 7), turnId: "turn" }],
        }),
      ]),
    );

    expect(toolItems(model)).toEqual([
      expect.objectContaining({
        status: "failed",
        selection: { kind: "event", id: "orphan-result", recordId: "record-orphan-result" },
        resultSelection: { kind: "event", id: "orphan-result", recordId: "record-orphan-result" },
        completionSelection: {
          kind: "event",
          id: "orphan-completion",
          recordId: "record-orphan-completion",
        },
        endedAt: 30,
        durationMs: 7,
      }),
    ]);
    expect(warningKinds(model)).toContain("unpaired-tool-result");
    expect(warningKinds(model)).not.toContain("unpaired-tool-completion");
  });

  it("leaves every occurrence independent when completions duplicate a call id", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("duplicate-completion-call", "record-duplicate-completion-call", 1, {
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCall("shell", "duplicate-completion"), turnId: "turn" }],
        }),
        event("duplicate-completion-result", "record-duplicate-completion-result", 2, {
          turnIndex: 1,
          trajectoryEvidence: [
            { ...toolResult("completed", "duplicate-completion"), turnId: "turn" },
          ],
        }),
        event("duplicate-completion-one", "record-duplicate-completion-one", 3, {
          turnIndex: 1,
          trajectoryEvidence: [
            { ...toolCompletion("completed", "duplicate-completion"), turnId: "turn" },
          ],
        }),
        event("duplicate-completion-two", "record-duplicate-completion-two", 4, {
          turnIndex: 1,
          trajectoryEvidence: [
            { ...toolCompletion("failed", "duplicate-completion"), turnId: "turn" },
          ],
        }),
      ]),
    );

    expect(toolItems(model)).toHaveLength(4);
    expect(
      toolItems(model).every(
        (item) =>
          !(item.callSelection && item.resultSelection) &&
          !(item.callSelection && item.completionSelection) &&
          !(item.resultSelection && item.completionSelection),
      ),
    ).toBe(true);
    expect(warningKinds(model)).toEqual(
      expect.arrayContaining([
        "duplicate-tool-completion-id",
        "unpaired-tool-call",
        "unpaired-tool-result",
        "unpaired-tool-completion",
      ]),
    );
  });

  it("prefers explicit tool durations and warns instead of deriving invalid durations", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("explicit-call", "record-explicit-call", 1, {
          timestamp: 100,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCall("explicit", "explicit"), turnId: "turn" }],
        }),
        event("explicit-result", "record-explicit-result", 2, {
          timestamp: 300,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolResult("completed", "explicit", 37), turnId: "turn" }],
        }),
        event("missing-call", "record-missing-call", 3, {
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCall("missing", "missing"), turnId: "turn" }],
        }),
        event("missing-result", "record-missing-result", 4, {
          timestamp: 450,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolResult("completed", "missing"), turnId: "turn" }],
        }),
        event("reversed-call", "record-reversed-call", 5, {
          timestamp: 600,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCall("reversed", "reversed"), turnId: "turn" }],
        }),
        event("reversed-result", "record-reversed-result", 6, {
          timestamp: 500,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolResult("completed", "reversed"), turnId: "turn" }],
        }),
        event("explicit-reversed-call", "record-explicit-reversed-call", 7, {
          timestamp: 700,
          turnIndex: 1,
          trajectoryEvidence: [
            { ...toolCall("explicit reversed", "explicit-reversed"), turnId: "turn" },
          ],
        }),
        event("explicit-reversed-result", "record-explicit-reversed-result", 8, {
          timestamp: 650,
          turnIndex: 1,
          trajectoryEvidence: [
            { ...toolResult("completed", "explicit-reversed", 7), turnId: "turn" },
          ],
        }),
        event("explicit-missing-call", "record-explicit-missing-call", 9, {
          turnIndex: 1,
          trajectoryEvidence: [
            { ...toolCall("explicit missing", "explicit-missing"), turnId: "turn" },
          ],
        }),
        event("explicit-missing-result", "record-explicit-missing-result", 10, {
          timestamp: 720,
          turnIndex: 1,
          trajectoryEvidence: [
            { ...toolResult("completed", "explicit-missing", 7), turnId: "turn" },
          ],
        }),
      ]),
    );

    const byCallId = new Map<string, Extract<AgentTrajectoryItem, { kind: "tool" }>>();
    for (const item of toolItems(model)) {
      if (item.callId) {
        byCallId.set(item.callId, item);
      }
    }

    expect(byCallId.get("explicit")).toMatchObject({
      startedAt: 100,
      endedAt: 300,
      durationMs: 37,
    });
    expect(byCallId.get("missing")).toMatchObject({ endedAt: 450 });
    expect(byCallId.get("missing")?.durationMs).toBeUndefined();
    expect(byCallId.get("reversed")).toMatchObject({ startedAt: 600, endedAt: 500 });
    expect(byCallId.get("reversed")?.durationMs).toBeUndefined();
    expect(byCallId.get("explicit-reversed")).toMatchObject({
      startedAt: 700,
      endedAt: 650,
      durationMs: 7,
    });
    expect(byCallId.get("explicit-missing")).toMatchObject({ endedAt: 720, durationMs: 7 });
    expect(warningKinds(model)).toEqual(
      expect.arrayContaining(["missing-timestamp", "reversed-timestamp"]),
    );
    expect(model.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "reversed-timestamp",
          subject: "tool",
          callId: "explicit-reversed",
          recordId: "record-explicit-reversed-result",
        }),
        expect.objectContaining({
          kind: "missing-timestamp",
          subject: "tool",
          endpoint: "call",
          callId: "explicit-missing",
          recordId: "record-explicit-missing-call",
        }),
      ]),
    );
  });

  it("prioritizes completion timing while preserving timestamp warnings", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("priority-call", "record-priority-call", 1, {
          timestamp: 100,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCall("priority", "priority"), turnId: "turn" }],
        }),
        event("priority-result", "record-priority-result", 2, {
          timestamp: 200,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolResult("completed", "priority", 11), turnId: "turn" }],
        }),
        event("priority-completion", "record-priority-completion", 3, {
          timestamp: 300,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCompletion("completed", "priority", 17), turnId: "turn" }],
        }),
        event("missing-completion-call", "record-missing-completion-call", 4, {
          timestamp: 400,
          turnIndex: 1,
          trajectoryEvidence: [
            { ...toolCall("missing completion", "missing-completion"), turnId: "turn" },
          ],
        }),
        event("missing-completion-result", "record-missing-completion-result", 5, {
          timestamp: 500,
          turnIndex: 1,
          trajectoryEvidence: [
            { ...toolResult("completed", "missing-completion", 13), turnId: "turn" },
          ],
        }),
        event("missing-completion", "record-missing-completion", 6, {
          turnIndex: 1,
          trajectoryEvidence: [
            { ...toolCompletion("completed", "missing-completion"), turnId: "turn" },
          ],
        }),
        event("reversed-completion-call", "record-reversed-completion-call", 7, {
          timestamp: 700,
          turnIndex: 1,
          trajectoryEvidence: [
            { ...toolCall("reversed completion", "reversed-completion"), turnId: "turn" },
          ],
        }),
        event("reversed-completion-result", "record-reversed-completion-result", 8, {
          timestamp: 800,
          turnIndex: 1,
          trajectoryEvidence: [
            { ...toolResult("completed", "reversed-completion"), turnId: "turn" },
          ],
        }),
        event("reversed-completion", "record-reversed-completion", 9, {
          timestamp: 600,
          turnIndex: 1,
          trajectoryEvidence: [
            { ...toolCompletion("completed", "reversed-completion", 19), turnId: "turn" },
          ],
        }),
      ]),
    );

    const byCallId = new Map<string, Extract<AgentTrajectoryItem, { kind: "tool" }>>();
    for (const item of toolItems(model)) {
      if (item.callId) {
        byCallId.set(item.callId, item);
      }
    }

    expect(byCallId.get("priority")).toMatchObject({ endedAt: 300, durationMs: 17 });
    expect(byCallId.get("missing-completion")).toMatchObject({
      endedAt: 500,
      durationMs: 13,
    });
    expect(byCallId.get("reversed-completion")).toMatchObject({
      endedAt: 600,
      durationMs: 19,
    });
    expect(model.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "missing-timestamp",
          subject: "tool",
          endpoint: "completion",
          callId: "missing-completion",
        }),
        expect.objectContaining({
          kind: "reversed-timestamp",
          subject: "tool",
          callId: "reversed-completion",
        }),
      ]),
    );
  });

  it("derives duration from the terminal timestamp selected after a missing completion time", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("fallback-duration-call", "record-fallback-duration-call", 1, {
          timestamp: 100,
          turnIndex: 1,
          trajectoryEvidence: [
            { ...toolCall("fallback duration", "fallback-duration"), turnId: "turn" },
          ],
        }),
        event("fallback-duration-result", "record-fallback-duration-result", 2, {
          timestamp: 250,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolResult("completed", "fallback-duration"), turnId: "turn" }],
        }),
        event("fallback-duration-completion", "record-fallback-duration-completion", 3, {
          turnIndex: 1,
          trajectoryEvidence: [
            { ...toolCompletion("completed", "fallback-duration"), turnId: "turn" },
          ],
        }),
      ]),
    );

    const tool = toolItems(model)[0];
    expect(tool).toMatchObject({ endedAt: 250, durationMs: 150 });
    expect(model.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "missing-timestamp",
          subject: "tool",
          endpoint: "completion",
          callId: "fallback-duration",
        }),
      ]),
    );
  });

  it("keeps lifecycle time facts while warning about missing and reversed ranges", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("reversed-start", "record-reversed-start", 1, {
          timestamp: 100,
          turnIndex: 1,
          trajectoryEvidence: [lifecycle("reversed-turn", "start")],
        }),
        event("reversed-complete", "record-reversed-complete", 2, {
          timestamp: 20,
          turnIndex: 1,
          trajectoryEvidence: [lifecycle("reversed-turn", "complete")],
        }),
        event("missing-start", "record-missing-start", 3, {
          turnIndex: 2,
          trajectoryEvidence: [lifecycle("missing-turn", "start")],
        }),
        event("missing-complete", "record-missing-complete", 4, {
          timestamp: 40,
          turnIndex: 2,
          trajectoryEvidence: [lifecycle("missing-turn", "complete")],
        }),
        event("terminal-missing-start", "record-terminal-missing-start", 5, {
          timestamp: 50,
          turnIndex: 3,
          trajectoryEvidence: [lifecycle("terminal-missing-turn", "start")],
        }),
        event("terminal-missing-complete", "record-terminal-missing-complete", 6, {
          turnIndex: 3,
          trajectoryEvidence: [lifecycle("terminal-missing-turn", "complete")],
        }),
      ]),
    );

    const reversed = model.turns.find(
      (turn) => turn.id === trajectoryTurnId("evidence", "reversed-turn"),
    );
    const missing = model.turns.find(
      (turn) => turn.id === trajectoryTurnId("evidence", "missing-turn"),
    );
    const terminalMissing = model.turns.find(
      (turn) => turn.id === trajectoryTurnId("evidence", "terminal-missing-turn"),
    );
    expect(reversed).toMatchObject({ status: "completed", startedAt: 100, endedAt: 20 });
    expect(reversed?.durationMs).toBeUndefined();
    expect(missing).toMatchObject({ status: "completed", endedAt: 40 });
    expect(missing?.startedAt).toBeUndefined();
    expect(missing?.durationMs).toBeUndefined();
    expect(terminalMissing).toMatchObject({ status: "completed", startedAt: 50 });
    expect(terminalMissing?.endedAt).toBeUndefined();
    expect(terminalMissing?.durationMs).toBeUndefined();
    expect(model.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "reversed-timestamp",
          subject: "turn",
          recordId: "record-reversed-complete",
          selection: {
            kind: "event",
            id: "reversed-complete",
            recordId: "record-reversed-complete",
          },
        }),
        expect.objectContaining({
          kind: "missing-timestamp",
          subject: "turn",
          endpoint: "start",
          recordId: "record-missing-start",
          selection: {
            kind: "event",
            id: "missing-start",
            recordId: "record-missing-start",
          },
        }),
        expect.objectContaining({
          kind: "missing-timestamp",
          subject: "turn",
          endpoint: "terminal",
          recordId: "record-terminal-missing-complete",
          selection: {
            kind: "event",
            id: "terminal-missing-complete",
            recordId: "record-terminal-missing-complete",
          },
        }),
      ]),
    );
  });

  it("distinguishes a missing lifecycle start from an observed non-terminal start", () => {
    const observed = conversation("observed-output", "assistant");
    const reversedObserved = conversation("reversed-observed-output", "assistant");
    const model = createAgentTrajectoryModel(
      session([
        event("terminal-only", "record-terminal-only", 1, {
          timestamp: 50,
          turnIndex: 1,
          trajectoryEvidence: [lifecycle("terminal-only", "complete")],
        }),
        event("observed-output", "record-observed-output", 2, {
          timestamp: 10,
          turnIndex: 2,
          conversationItems: [observed],
          trajectoryEvidence: [{ ...modelOutput("assistant", observed.id), turnId: "observed" }],
        }),
        event("observed-complete", "record-observed-complete", 3, {
          timestamp: 50,
          turnIndex: 2,
          trajectoryEvidence: [lifecycle("observed", "complete")],
        }),
        event("reversed-observed-output", "record-reversed-observed-output", 4, {
          timestamp: 100,
          turnIndex: 3,
          conversationItems: [reversedObserved],
          trajectoryEvidence: [
            { ...modelOutput("assistant", reversedObserved.id), turnId: "reversed-observed" },
          ],
        }),
        event("reversed-observed-complete", "record-reversed-observed-complete", 5, {
          timestamp: 20,
          turnIndex: 3,
          trajectoryEvidence: [lifecycle("reversed-observed", "complete")],
        }),
      ]),
    );

    const terminalOnly = model.turns[0];
    const observedTurn = model.turns[1];
    const reversedObservedTurn = model.turns[2];
    expect(terminalOnly).toMatchObject({ status: "completed", endedAt: 50 });
    expect(terminalOnly?.startedAt).toBeUndefined();
    expect(terminalOnly?.durationMs).toBeUndefined();
    expect(observedTurn).toMatchObject({ startedAt: 10, endedAt: 50, durationMs: 40 });
    expect(reversedObservedTurn).toMatchObject({ startedAt: 100, endedAt: 20 });
    expect(reversedObservedTurn?.durationMs).toBeUndefined();
    expect(model.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "missing-turn-start",
          turnId: "terminal-only",
          recordId: "record-terminal-only",
          selection: {
            kind: "event",
            id: "terminal-only",
            recordId: "record-terminal-only",
          },
        }),
        expect.objectContaining({
          kind: "reversed-timestamp",
          subject: "turn",
          turnId: "reversed-observed",
          recordId: "record-reversed-observed-complete",
        }),
      ]),
    );
  });

  it("uses the earliest observed non-terminal timestamp without sorting", () => {
    const lateObserved = conversation("late-observed", "assistant");
    const laterAssistant = conversation("later-assistant", "assistant");
    const earlierReasoning = conversation("earlier-reasoning", "thinking");
    const model = createAgentTrajectoryModel(
      session([
        event("late-observed-complete", "record-late-observed-complete", 1, {
          timestamp: 20,
          turnIndex: 1,
          trajectoryEvidence: [lifecycle("late-observed-turn", "complete")],
        }),
        event("late-observed", "record-late-observed", 2, {
          timestamp: 10,
          turnIndex: 1,
          conversationItems: [lateObserved],
          trajectoryEvidence: [
            { ...modelOutput("assistant", lateObserved.id), turnId: "late-observed-turn" },
          ],
        }),
        event("later-assistant", "record-later-assistant", 3, {
          timestamp: 100,
          turnIndex: 2,
          conversationItems: [laterAssistant],
          trajectoryEvidence: [
            { ...modelOutput("assistant", laterAssistant.id), turnId: "earliest-turn" },
          ],
        }),
        event("earlier-reasoning", "record-earlier-reasoning", 4, {
          timestamp: 10,
          turnIndex: 2,
          conversationItems: [earlierReasoning],
          trajectoryEvidence: [
            { ...modelOutput("reasoning", earlierReasoning.id), turnId: "earliest-turn" },
          ],
        }),
        event("earliest-complete", "record-earliest-complete", 5, {
          timestamp: 200,
          turnIndex: 2,
          trajectoryEvidence: [lifecycle("earliest-turn", "complete")],
        }),
      ]),
    );

    expect(model.turns).toMatchObject([
      {
        id: trajectoryTurnId("evidence", "late-observed-turn"),
        startedAt: 10,
        endedAt: 20,
        durationMs: 10,
      },
      {
        id: trajectoryTurnId("evidence", "earliest-turn"),
        startedAt: 10,
        endedAt: 200,
        durationMs: 190,
      },
    ]);
    expect(model.warnings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "missing-turn-start", turnId: "late-observed-turn" }),
      ]),
    );
  });

  it("derives one recovery step without making a failed tool fail the turn", () => {
    const initial = conversation("initial", "assistant");
    const userAfterResult = conversation("user-after-result", "user");
    const recovered = conversation("recovered", "assistant");
    const continued = conversation("continued", "thinking");
    const nextTurnAssistant = conversation("next-turn-assistant", "assistant");
    const model = createAgentTrajectoryModel(
      session([
        event("turn-start", "record-start", 1, {
          turnIndex: 1,
          trajectoryEvidence: [lifecycle("turn-one", "start")],
        }),
        event("initial", "record-initial", 2, {
          turnIndex: 1,
          conversationItems: [initial],
          trajectoryEvidence: [{ ...modelOutput("assistant", initial.id), turnId: "turn-one" }],
        }),
        event("first-call", "record-first-call", 3, {
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCall("first", "first"), turnId: "turn-one" }],
        }),
        event("first-result", "record-first-result", 4, {
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolResult("failed", "first"), turnId: "turn-one" }],
        }),
        event("second-call", "record-second-call", 5, {
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCall("second", "second"), turnId: "turn-one" }],
        }),
        event("second-result", "record-second-result", 6, {
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolResult("completed", "second"), turnId: "turn-one" }],
        }),
        event("user-after-result", "record-user-after-result", 7, {
          turnIndex: 1,
          conversationItems: [userAfterResult],
          trajectoryEvidence: [{ ...modelOutput("user", userAfterResult.id), turnId: "turn-one" }],
        }),
        event("recovered", "record-recovered", 8, {
          turnIndex: 1,
          conversationItems: [recovered],
          trajectoryEvidence: [{ ...modelOutput("assistant", recovered.id), turnId: "turn-one" }],
        }),
        event("continued", "record-continued", 9, {
          turnIndex: 1,
          conversationItems: [continued],
          trajectoryEvidence: [{ ...modelOutput("reasoning", continued.id), turnId: "turn-one" }],
        }),
        event("third-call", "record-third-call", 10, {
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCall("third", "third"), turnId: "turn-one" }],
        }),
        event("third-result", "record-third-result", 11, {
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolResult("completed", "third"), turnId: "turn-one" }],
        }),
        event("turn-complete", "record-complete", 12, {
          turnIndex: 1,
          trajectoryEvidence: [lifecycle("turn-one", "complete")],
        }),
        event("next-turn-start", "record-next-start", 13, {
          turnIndex: 2,
          trajectoryEvidence: [lifecycle("turn-two", "start")],
        }),
        event("next-turn-assistant", "record-next-assistant", 14, {
          turnIndex: 2,
          conversationItems: [nextTurnAssistant],
          trajectoryEvidence: [
            { ...modelOutput("assistant", nextTurnAssistant.id), turnId: "turn-two" },
          ],
        }),
      ]),
    );

    expect(itemById(model, "initial:evidence-0").step).toBeUndefined();
    expect(userItemById(model, "user-after-result:evidence-0").kind).toBe("user");
    expect(itemById(model, "recovered:evidence-0").step).toEqual({ index: 1, source: "derived" });
    expect(itemById(model, "continued:evidence-0").step).toBeUndefined();
    expect(itemById(model, "next-turn-assistant:evidence-0").step).toBeUndefined();
    expect(model.turns[0]?.status).toBe("completed");
    expect(toolItems(model).filter((item) => item.status === "failed")).toHaveLength(1);
  });

  it("attaches sparse token usage only to the prior model output while retaining safe totals", () => {
    const firstAssistant = conversation("first-assistant", "assistant");
    const firstReasoning = conversation("first-reasoning", "thinking");
    const secondAssistant = conversation("second-assistant", "assistant");
    const model = createAgentTrajectoryModel(
      session([
        event("early-first-token", "record-early-first-token", 1, {
          turnIndex: 1,
          trajectoryEvidence: [tokenUsage({ inputTokens: 99 }, "turn-one")],
        }),
        event("first-assistant", "record-first-assistant", 2, {
          turnIndex: 1,
          conversationItems: [firstAssistant],
          trajectoryEvidence: [
            { ...modelOutput("assistant", firstAssistant.id), turnId: "turn-one" },
          ],
        }),
        event("first-reasoning", "record-first-reasoning", 3, {
          turnIndex: 1,
          conversationItems: [firstReasoning],
          trajectoryEvidence: [
            { ...modelOutput("reasoning", firstReasoning.id), turnId: "turn-one" },
          ],
        }),
        event("first-token", "record-first-token", 4, {
          turnIndex: 1,
          trajectoryEvidence: [
            tokenUsage({ inputTokens: 3, cacheCreationInputTokens: 2 }, "turn-one"),
          ],
        }),
        event("second-first-token", "record-second-first-token", 5, {
          turnIndex: 1,
          trajectoryEvidence: [tokenUsage({ outputTokens: 4 }, "turn-one")],
        }),
        event("early-second-token", "record-early-second-token", 6, {
          turnIndex: 2,
          trajectoryEvidence: [tokenUsage({ outputTokens: 50 }, "turn-two")],
        }),
        event("second-assistant", "record-second-assistant", 7, {
          turnIndex: 2,
          conversationItems: [secondAssistant],
          trajectoryEvidence: [
            { ...modelOutput("assistant", secondAssistant.id), turnId: "turn-two" },
          ],
        }),
        event("second-token", "record-second-token", 8, {
          turnIndex: 2,
          trajectoryEvidence: [
            tokenUsage({ inputTokens: 5, cacheReadInputTokens: 7, outputTokens: 1 }, "turn-two"),
          ],
        }),
        event("invalid-token", "record-invalid-token", 9, {
          turnIndex: 2,
          trajectoryEvidence: [
            tokenUsage(
              {
                inputTokens: -1,
                cacheReadInputTokens: Number.POSITIVE_INFINITY,
                outputTokens: Number.MAX_SAFE_INTEGER,
              },
              "turn-two",
            ),
          ],
        }),
        event("unscoped-token", "record-unscoped-token", 10, {
          trajectoryEvidence: [tokenUsage({ outputTokens: 30 })],
        }),
      ]),
    );

    expect(itemById(model, "first-assistant:evidence-0").tokenUsage).toBeUndefined();
    expect(itemById(model, "first-reasoning:evidence-0").tokenUsage).toEqual({
      inputTokens: 3,
      cacheCreationInputTokens: 2,
      outputTokens: 4,
    });
    expect(itemById(model, "second-assistant:evidence-0").tokenUsage).toEqual({
      inputTokens: 5,
      cacheReadInputTokens: 7,
      outputTokens: 1,
    });
    expect(model.stats.tokenUsage).toEqual({
      inputTokens: 107,
      cacheCreationInputTokens: 2,
      cacheReadInputTokens: 7,
      outputTokens: 85,
    });
    expect(warningKinds(model).filter((kind) => kind === "unattached-token-usage")).toHaveLength(3);
  });

  it("uses cumulative snapshots for totals without double counting incremental usage", () => {
    const firstAssistant = conversation("snapshot-first", "assistant");
    const secondAssistant = conversation("snapshot-second", "assistant");
    const model = createAgentTrajectoryModel(
      session([
        event("snapshot-first", "record-snapshot-first", 1, {
          turnIndex: 1,
          conversationItems: [firstAssistant],
          trajectoryEvidence: [
            { ...modelOutput("assistant", firstAssistant.id), turnId: "snapshot-turn" },
          ],
        }),
        event("snapshot-first-token", "record-snapshot-first-token", 2, {
          turnIndex: 1,
          trajectoryEvidence: [
            tokenUsageWithCumulative(
              { inputTokens: 100, outputTokens: 10 },
              { inputTokens: 100, outputTokens: 10 },
              "snapshot-turn",
            ),
          ],
        }),
        event("snapshot-second", "record-snapshot-second", 3, {
          turnIndex: 1,
          conversationItems: [secondAssistant],
          trajectoryEvidence: [
            { ...modelOutput("assistant", secondAssistant.id), turnId: "snapshot-turn" },
          ],
        }),
        event("snapshot-second-token", "record-snapshot-second-token", 4, {
          turnIndex: 1,
          trajectoryEvidence: [
            tokenUsageWithCumulative(
              { inputTokens: 20, outputTokens: 5 },
              { inputTokens: 120, outputTokens: 15 },
              "snapshot-turn",
            ),
          ],
        }),
      ]),
    );

    expect(itemById(model, "snapshot-first:evidence-0").tokenUsage).toEqual({
      inputTokens: 100,
      outputTokens: 10,
    });
    expect(itemById(model, "snapshot-second:evidence-0").tokenUsage).toEqual({
      inputTokens: 20,
      outputTokens: 5,
    });
    expect(model.stats.tokenUsage).toEqual({ inputTokens: 120, outputTokens: 15 });
  });

  it("merges incremental and cumulative token components per key", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("initial-snapshot", "record-initial-snapshot", 1, {
          trajectoryEvidence: [
            cumulativeTokenUsage({ inputTokens: 100, outputTokens: 10 }, "partial-snapshot-turn"),
          ],
        }),
        event("partial-snapshot", "record-partial-snapshot", 2, {
          trajectoryEvidence: [
            tokenUsageWithCumulative(
              { inputTokens: 999, outputTokens: 3, reasoningOutputTokens: 7 },
              { inputTokens: 120, cacheReadInputTokens: 5 },
              "partial-snapshot-turn",
            ),
          ],
        }),
      ]),
    );

    expect(model.stats.tokenUsage).toEqual({
      inputTokens: 120,
      cacheReadInputTokens: 5,
      outputTokens: 13,
      reasoningOutputTokens: 7,
    });
  });

  it("retains prior cumulative components when a later snapshot omits them", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("snapshot-one", "record-snapshot-one", 1, {
          trajectoryEvidence: [cumulativeTokenUsage({ inputTokens: 100, outputTokens: 10 })],
        }),
        event("snapshot-two", "record-snapshot-two", 2, {
          trajectoryEvidence: [cumulativeTokenUsage({ inputTokens: 120 })],
        }),
      ]),
    );

    expect(model.stats.tokenUsage).toEqual({ inputTokens: 120, outputTokens: 10 });
  });

  it("updates totals from cumulative-only evidence without an unattached warning", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("cumulative-only", "record-cumulative-only", 1, {
          turnIndex: 1,
          trajectoryEvidence: [
            cumulativeTokenUsage({ inputTokens: 50, outputTokens: 8 }, "cumulative-turn"),
          ],
        }),
      ]),
    );

    expect(model.stats.tokenUsage).toEqual({ inputTokens: 50, outputTokens: 8 });
    expect(warningKinds(model)).not.toContain("unattached-token-usage");
  });

  it("accumulates flat incremental usage without a cumulative snapshot", () => {
    const assistant = conversation("flat-incremental", "assistant");
    const model = createAgentTrajectoryModel(
      session([
        event("flat-incremental", "record-flat-incremental", 1, {
          turnIndex: 1,
          conversationItems: [assistant],
          trajectoryEvidence: [{ ...modelOutput("assistant", assistant.id), turnId: "flat-turn" }],
        }),
        event("flat-first", "record-flat-first", 2, {
          turnIndex: 1,
          trajectoryEvidence: [tokenUsage({ inputTokens: 2 }, "flat-turn")],
        }),
        event("flat-second", "record-flat-second", 3, {
          turnIndex: 1,
          trajectoryEvidence: [tokenUsage({ inputTokens: 3, outputTokens: 1 }, "flat-turn")],
        }),
      ]),
    );

    expect(itemById(model, "flat-incremental:evidence-0").tokenUsage).toEqual({
      inputTokens: 5,
      outputTokens: 1,
    });
    expect(model.stats.tokenUsage).toEqual({ inputTokens: 5, outputTokens: 1 });
  });

  it("continues flat increments after a cumulative snapshot and filters invalid fields", () => {
    const assistant = conversation("snapshot-increment", "assistant");
    const model = createAgentTrajectoryModel(
      session([
        event("snapshot-increment", "record-snapshot-increment", 1, {
          turnIndex: 1,
          conversationItems: [assistant],
          trajectoryEvidence: [
            { ...modelOutput("assistant", assistant.id), turnId: "snapshot-increment-turn" },
          ],
        }),
        event("snapshot", "record-snapshot", 2, {
          turnIndex: 1,
          trajectoryEvidence: [
            cumulativeTokenUsage(
              {
                inputTokens: 100,
                outputTokens: 10,
                cacheReadInputTokens: -1,
              },
              "snapshot-increment-turn",
            ),
          ],
        }),
        event("snapshot-after-increment", "record-snapshot-increment-after", 3, {
          turnIndex: 1,
          trajectoryEvidence: [
            tokenUsage(
              {
                inputTokens: 20,
                outputTokens: 5,
                cacheCreationInputTokens: Number.POSITIVE_INFINITY,
              },
              "snapshot-increment-turn",
            ),
          ],
        }),
        event("overflow", "record-overflow", 4, {
          turnIndex: 1,
          trajectoryEvidence: [
            tokenUsage(
              {
                inputTokens: Number.MAX_SAFE_INTEGER,
                outputTokens: Number.MAX_SAFE_INTEGER,
              },
              "snapshot-increment-turn",
            ),
          ],
        }),
      ]),
    );

    expect(itemById(model, "snapshot-increment:evidence-0").tokenUsage).toEqual({
      inputTokens: 20,
      outputTokens: 5,
    });
    expect(model.stats.tokenUsage).toEqual({ inputTokens: 120, outputTokens: 15 });
  });

  it("leaves missing and duplicate call ids unpaired", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("idless-call", "record-idless-call", 1, {
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCall("idless"), turnId: "turn" }],
        }),
        event("idless-result", "record-idless-result", 2, {
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolResult("completed"), turnId: "turn" }],
        }),
        event("first-duplicate-call", "record-first-duplicate-call", 3, {
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCall("first", "duplicate"), turnId: "turn" }],
        }),
        event("second-duplicate-call", "record-second-duplicate-call", 4, {
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCall("second", "duplicate"), turnId: "turn" }],
        }),
        event("duplicate-result", "record-duplicate-result", 5, {
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolResult("completed", "duplicate"), turnId: "turn" }],
        }),
      ]),
    );

    const duplicateItems = toolItems(model).filter((item) => item.callId === "duplicate");
    expect(toolItems(model)).toHaveLength(5);
    expect(duplicateItems).toHaveLength(3);
    expect(duplicateItems.every((item) => !(item.callSelection && item.resultSelection))).toBe(
      true,
    );
    expect(duplicateItems.map((item) => item.status)).toEqual(["running", "running", "completed"]);
    expect(warningKinds(model)).toEqual(
      expect.arrayContaining([
        "duplicate-tool-call-id",
        "unpaired-tool-call",
        "unpaired-tool-result",
      ]),
    );
  });

  it("does not silently pair duplicate results for one call id in a turn", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("duplicate-result-call", "record-duplicate-result-call", 1, {
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCall("shell", "duplicate-result"), turnId: "turn" }],
        }),
        event("first-duplicate-result", "record-first-duplicate-result", 2, {
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolResult("completed", "duplicate-result"), turnId: "turn" }],
        }),
        event("second-duplicate-result", "record-second-duplicate-result", 3, {
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolResult("failed", "duplicate-result"), turnId: "turn" }],
        }),
      ]),
    );

    expect(toolItems(model)).toHaveLength(3);
    expect(toolItems(model).every((item) => !(item.callSelection && item.resultSelection))).toBe(
      true,
    );
    expect(warningKinds(model)).toEqual(
      expect.arrayContaining([
        "duplicate-tool-result-id",
        "unpaired-tool-call",
        "unpaired-tool-result",
      ]),
    );
  });

  it("filters a duplicate Event before unscoped tool pairing", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("unscoped-event", "record-unscoped-call", 1, {
          trajectoryEvidence: [toolCall("shell", "unscoped")],
        }),
        event("unscoped-event", "record-unscoped-result", 2, {
          trajectoryEvidence: [toolResult("completed", "unscoped")],
        }),
      ]),
    );

    expect(toolItems(model).map((item) => item.status)).toEqual(["running"]);
    expect(warningKinds(model)).toContain("unpaired-tool-call");
    expect(warningKinds(model)).not.toContain("unpaired-tool-result");
  });

  it("pairs anonymous call ids across canonical Events with canonical selections", () => {
    const call = conversation("anonymous-call", "tool_call");
    const result = conversation("anonymous-result", "tool_result");
    const source = session([
      event("anonymous-call-event", "record-anonymous-call", 1, {
        timestamp: 10,
        conversationItems: [call],
        trajectoryEvidence: [toolCall("shell", "anonymous", call.id)],
      }),
      event("anonymous-result-event", "record-anonymous-result", 2, {
        timestamp: 25,
        conversationItems: [result],
        trajectoryEvidence: [toolResult("completed", "anonymous", undefined, result.id)],
      }),
    ]);
    const model = createAgentTrajectoryModel(source);
    const canonical = createAgentSessionModel(source);

    expect(toolItems(model)).toMatchObject([
      {
        id: "anonymous-call-event:evidence-0",
        status: "completed",
        startedAt: 10,
        endedAt: 25,
        durationMs: 15,
        callSelection: {
          kind: "conversation",
          id: "anonymous-call",
          recordId: "record-anonymous-call",
        },
        resultSelection: {
          kind: "conversation",
          id: "anonymous-result",
          recordId: "record-anonymous-result",
        },
      },
    ]);
    expect(warningKinds(model)).not.toEqual(
      expect.arrayContaining(["unpaired-tool-call", "unpaired-tool-result"]),
    );
    const [tool] = toolItems(model);
    expect(canonical.resolveDetail(tool?.callSelection ?? null)?.recordId).toBe(
      "record-anonymous-call",
    );
    expect(canonical.resolveDetail(tool?.resultSelection ?? null)?.recordId).toBe(
      "record-anonymous-result",
    );
  });

  it("leaves ambiguous anonymous call ids unpaired with duplicate warnings", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("anonymous-call-one", "record-anonymous-call-one", 1, {
          trajectoryEvidence: [toolCall("shell", "anonymous-duplicate")],
        }),
        event("anonymous-call-two", "record-anonymous-call-two", 2, {
          trajectoryEvidence: [toolCall("read_file", "anonymous-duplicate")],
        }),
        event("anonymous-result", "record-anonymous-result", 3, {
          trajectoryEvidence: [toolResult("completed", "anonymous-duplicate")],
        }),
      ]),
    );

    expect(toolItems(model).map((item) => item.status)).toEqual([
      "running",
      "running",
      "completed",
    ]);
    expect(toolItems(model).every((item) => !(item.callSelection && item.resultSelection))).toBe(
      true,
    );
    expect(warningKinds(model)).toEqual(
      expect.arrayContaining([
        "duplicate-tool-call-id",
        "unpaired-tool-call",
        "unpaired-tool-result",
      ]),
    );
  });

  it("keeps explicit turns and the anonymous scope isolated for a shared call id", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("turn-a-call", "record-turn-a-call", 1, {
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCall("turn-a", "shared"), turnId: "turn-a" }],
        }),
        event("turn-b-call", "record-turn-b-call", 2, {
          turnIndex: 2,
          trajectoryEvidence: [{ ...toolCall("turn-b", "shared"), turnId: "turn-b" }],
        }),
        event("anonymous-call", "record-anonymous-call", 3, {
          trajectoryEvidence: [toolCall("anonymous", "shared")],
        }),
        event("turn-a-result", "record-turn-a-result", 4, {
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolResult("completed", "shared"), turnId: "turn-a" }],
        }),
        event("turn-b-result", "record-turn-b-result", 5, {
          turnIndex: 2,
          trajectoryEvidence: [{ ...toolResult("failed", "shared"), turnId: "turn-b" }],
        }),
        event("anonymous-result", "record-anonymous-result", 6, {
          trajectoryEvidence: [toolResult("completed", "shared")],
        }),
      ]),
    );

    expect(
      toolItems(model).map(({ toolName, status, callId }) => ({ toolName, status, callId })),
    ).toEqual([
      { toolName: "turn-a", status: "completed", callId: "shared" },
      { toolName: "turn-b", status: "failed", callId: "shared" },
      { toolName: "anonymous", status: "completed", callId: "shared" },
    ]);
  });

  it("preserves an aborted lifecycle without inventing a tool outcome", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("start", "record-start", 1, {
          turnIndex: 1,
          trajectoryEvidence: [lifecycle("aborted-turn", "start")],
        }),
        event("call", "record-call", 2, {
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCall("shell", "open"), turnId: "aborted-turn" }],
        }),
        event("abort", "record-abort", 3, {
          turnIndex: 1,
          trajectoryEvidence: [lifecycle("aborted-turn", "aborted")],
        }),
      ]),
    );

    expect(model.turns[0]?.status).toBe("aborted");
    expect(toolItems(model)[0]?.status).toBe("running");
    expect(warningKinds(model)).not.toContain("open-turn");
  });

  it("projects observed subagent states and compaction facts only when their evidence exists", () => {
    const source = session([
      event("subagent", "opaque:subagent", 7, {
        trajectoryEvidence: [{ kind: "subagent-activity", status: "running" }],
      }),
      event("failed-subagent", "opaque:failed-subagent", 8, {
        trajectoryEvidence: [{ kind: "subagent-activity", status: "failed" }],
      }),
      event("compaction", "opaque:compaction", 9, {
        trajectoryEvidence: [{ kind: "compaction" }],
      }),
    ]);
    const model = createAgentTrajectoryModel(source);
    const canonicalModel = createAgentSessionModel(source);

    expect(
      model.items.map(({ kind, status, recordId, lineNumber, selection }) => ({
        kind,
        status,
        recordId,
        lineNumber,
        selection,
      })),
    ).toEqual([
      {
        kind: "subagent",
        status: "running",
        recordId: "opaque:subagent",
        lineNumber: 7,
        selection: { kind: "event", id: "subagent", recordId: "opaque:subagent" },
      },
      {
        kind: "subagent",
        status: "failed",
        recordId: "opaque:failed-subagent",
        lineNumber: 8,
        selection: {
          kind: "event",
          id: "failed-subagent",
          recordId: "opaque:failed-subagent",
        },
      },
      {
        kind: "compaction",
        status: "completed",
        recordId: "opaque:compaction",
        lineNumber: 9,
        selection: { kind: "event", id: "compaction", recordId: "opaque:compaction" },
      },
    ]);
    for (const item of model.items) {
      expect(canonicalModel.resolveDetail(item.selection)?.recordId).toBe(item.recordId);
    }
  });

  it("keeps duplicate conversation ids local to their canonical Event", () => {
    const first = conversation("shared-conversation", "assistant");
    const second = conversation("shared-conversation", "assistant");
    const source = session([
      event("first-event", "record-first", 1, {
        conversationItems: [first],
        trajectoryEvidence: [modelOutput("assistant", first.id)],
      }),
      event("second-event", "record-second", 2, {
        conversationItems: [second],
        trajectoryEvidence: [modelOutput("assistant", second.id)],
      }),
    ]);
    const trajectory = createAgentTrajectoryModel(source);
    const canonical = createAgentSessionModel(source);

    expect(trajectory.items).toHaveLength(2);
    expect(trajectory.items[0]?.id).not.toBe(trajectory.items[1]?.id);
    expect(trajectory.items[0]?.selection).toEqual({
      kind: "conversation",
      id: "shared-conversation",
      recordId: "record-first",
    });
    expect(trajectory.items[1]?.selection).toEqual({
      kind: "event",
      id: "second-event",
      recordId: "record-second",
    });
    expect(canonical.resolveDetail(trajectory.items[0]?.selection ?? null)?.recordId).toBe(
      "record-first",
    );
    expect(canonical.resolveDetail(trajectory.items[1]?.selection ?? null)?.recordId).toBe(
      "record-second",
    );
  });

  it("excludes duplicate event and Record facts before trajectory projection", () => {
    const source = session([
      event("canonical-event", "canonical-record", 1, {
        trajectoryEvidence: [modelOutput("assistant")],
      }),
      event("canonical-event", "other-record", 2, {
        trajectoryEvidence: [modelOutput("assistant")],
      }),
      event("other-event", "canonical-record", 3, {
        trajectoryEvidence: [modelOutput("assistant")],
      }),
    ]);
    const trajectory = createAgentTrajectoryModel(source);
    const canonical = createAgentSessionModel(source);

    expect(trajectory.items).toHaveLength(1);
    expect(trajectory.items[0]).toMatchObject({
      id: "canonical-event:evidence-0",
      recordId: "canonical-record",
    });
    expect(canonical.events).toHaveLength(1);
  });

  it("gives repeated conversation evidence in one Event distinct canonical item ids", () => {
    const shared = conversation("same-event-conversation", "assistant");
    const source = session([
      event("same-event", "same-event-record", 1, {
        conversationItems: [shared],
        trajectoryEvidence: [
          modelOutput("assistant", shared.id),
          modelOutput("reasoning", shared.id),
        ],
      }),
    ]);
    const trajectory = createAgentTrajectoryModel(source);
    const canonical = createAgentSessionModel(source);

    expect(trajectory.items.map((item) => item.id)).toEqual([
      "same-event:evidence-0",
      "same-event:evidence-1",
    ]);
    for (const item of trajectory.items) {
      expect(canonical.resolveDetail(item.selection)?.recordId).toBe("same-event-record");
    }
  });

  it("uses canonical opaque Records for every projected selection", () => {
    const output = conversation("opaque-output", "assistant");
    const call = conversation("opaque-call", "tool_call");
    const result = conversation("opaque-result", "tool_result");
    const source = session([
      event("opaque-output-event", "source-revision:9/record:opaque-output", 101, {
        turnIndex: 1,
        conversationItems: [output],
        trajectoryEvidence: [{ ...modelOutput("assistant", output.id), turnId: "opaque-turn" }],
      }),
      event("opaque-call-event", "source-revision:9/record:opaque-call", 102, {
        turnIndex: 1,
        conversationItems: [call],
        trajectoryEvidence: [
          { ...toolCall("shell", "opaque-call-id", call.id), turnId: "opaque-turn" },
        ],
      }),
      event("opaque-result-event", "source-revision:9/record:opaque-result", 103, {
        turnIndex: 1,
        conversationItems: [result],
        trajectoryEvidence: [
          {
            ...toolResult("completed", "opaque-call-id", undefined, result.id),
            turnId: "opaque-turn",
          },
        ],
      }),
    ]);
    const canonicalModel = createAgentSessionModel(source);
    const trajectory = createAgentTrajectoryModel(source);

    for (const item of trajectory.items) {
      const detail = canonicalModel.resolveDetail(item.selection);
      expect(detail?.recordId).toBe(item.recordId);
    }

    const [tool] = toolItems(trajectory);
    expect(tool?.id).toBe("opaque-call-event:evidence-0");
    expect(tool?.callSelection).toEqual({
      kind: "conversation",
      id: "opaque-call",
      recordId: "source-revision:9/record:opaque-call",
    });
    expect(tool?.resultSelection).toEqual({
      kind: "conversation",
      id: "opaque-result",
      recordId: "source-revision:9/record:opaque-result",
    });
    expect(canonicalModel.resolveDetail(tool?.resultSelection ?? null)?.recordId).toBe(
      "source-revision:9/record:opaque-result",
    );
  });

  it("scans 4K facts across multiple Events without collection searches", () => {
    const events: AgentTimelineEvent[] = [
      event("large-start", "opaque:large:start", 1, {
        timestamp: 0,
        turnIndex: 1,
        trajectoryEvidence: [lifecycle("large-turn", "start")],
      }),
    ];
    for (let eventIndex = 0; eventIndex < 38; eventIndex += 1) {
      const evidence: AgentTrajectoryEvidence[] = [];
      for (let evidenceIndex = 0; evidenceIndex < 100; evidenceIndex += 1) {
        evidence.push({ ...modelOutput("assistant"), turnId: "large-turn" });
      }
      events.push(
        event(`large-output-${eventIndex}`, `opaque:large:${eventIndex}`, eventIndex + 2, {
          timestamp: eventIndex + 1,
          turnIndex: 1,
          trajectoryEvidence: evidence,
        }),
      );
    }
    const tailEvidence: AgentTrajectoryEvidence[] = [];
    for (let evidenceIndex = 0; evidenceIndex < 196; evidenceIndex += 1) {
      tailEvidence.push({ ...modelOutput("assistant"), turnId: "large-turn" });
    }
    tailEvidence.push(
      { ...toolCall("large-tool", "large-call"), turnId: "large-turn" },
      { ...toolResult("completed", "large-call"), turnId: "large-turn" },
      lifecycle("large-turn", "complete"),
    );
    events.push(
      event("large-tail", "opaque:large:tail", 40, {
        timestamp: 100,
        turnIndex: 1,
        trajectoryEvidence: tailEvidence,
      }),
    );

    let eventIteratorReads = 0;
    let evidenceIteratorReads = 0;
    const guardedEventFacts: AgentTimelineEvent[] = [];
    for (const current of events) {
      const currentEvidence = current.trajectoryEvidence ?? [];
      const guardedEvidence = new Proxy(currentEvidence, {
        get(target, property, receiver) {
          if (property === "find" || property === "filter") {
            throw new Error(`Unexpected evidence ${String(property)} search`);
          }
          if (property === Symbol.iterator) {
            evidenceIteratorReads += 1;
          }
          return Reflect.get(target, property, receiver);
        },
      });
      guardedEventFacts.push({ ...current, trajectoryEvidence: guardedEvidence });
    }
    const guardedEvents = new Proxy(guardedEventFacts, {
      get(target, property, receiver) {
        if (property === "find" || property === "filter") {
          throw new Error(`Unexpected event ${String(property)} search`);
        }
        if (property === Symbol.iterator) {
          eventIteratorReads += 1;
        }
        return Reflect.get(target, property, receiver);
      },
    });

    const model = createAgentTrajectoryModel(session(guardedEvents));

    expect(model.items).toHaveLength(3_997);
    expect(toolItems(model)).toHaveLength(1);
    expect(toolItems(model).filter((item) => item.status === "failed")).toHaveLength(0);
    expect(model.turns).toMatchObject([
      { id: trajectoryTurnId("evidence", "large-turn"), status: "completed", durationMs: 100 },
    ]);
    expect(eventIteratorReads).toBe(1);
    expect(evidenceIteratorReads).toBe(40);
  });
});
