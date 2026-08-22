import {
  type AgentConversationItem,
  type AgentDetailSelection,
  type AgentTokenUsageEvidence,
  type AgentTrajectoryEvidence,
  type AgentTrajectoryAssistantReasoningItem,
  type AgentTrajectoryItem,
  type AgentTrajectoryModel,
  type AgentTrajectoryToolItem,
  type AgentTrajectoryUserItem,
  type AgentTrajectoryWarning,
  type AgentTimelineEvent,
  type AgentSession,
} from "../src/lib/agent-session";

export interface EventOptions {
  timestamp?: number;
  turnIndex?: number;
  trajectoryEvidence?: readonly AgentTrajectoryEvidence[];
  conversationItems?: AgentConversationItem[];
}

export const event = (
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

export const session = (events: AgentTimelineEvent[]): AgentSession => ({
  fileType: "Codex",
  meta: { turnCount: 0 },
  events,
  parseWarnings: [],
  parseWarningCount: 0,
});

export const conversation = (
  id: string,
  role: AgentConversationItem["role"],
): AgentConversationItem => ({
  id,
  role,
});

export const lifecycle = (
  turnId: string,
  phase: "start" | "complete" | "failed" | "aborted",
): AgentTrajectoryEvidence => ({ kind: "turn-lifecycle", turnId, phase });

export const modelOutput = (
  role: "user" | "assistant" | "reasoning" | "system",
  conversationItemId?: string,
): AgentTrajectoryEvidence => ({
  kind: "model-output",
  role,
  ...(conversationItemId === undefined ? {} : { conversationItemId }),
});

export const toolCall = (
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

export const toolResult = (
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

export const unknownToolResult = (callId?: string): AgentTrajectoryEvidence =>
  ({
    kind: "tool-lifecycle",
    phase: "result",
    ...(callId === undefined ? {} : { callId }),
  }) satisfies AgentTrajectoryEvidence;

export const toolCompletion = (
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

export const tokenUsage = (
  usage: Record<string, number>,
  turnId?: string,
): AgentTrajectoryEvidence => ({
  kind: "token-usage",
  usage,
  ...(turnId === undefined ? {} : { turnId }),
});

export const tokenUsageWithCumulative = (
  usage: Record<string, number>,
  cumulativeUsage: Record<string, number>,
  turnId?: string,
): AgentTokenUsageEvidence => ({
  kind: "token-usage",
  usage,
  cumulativeUsage,
  ...(turnId === undefined ? {} : { turnId }),
});

export const cumulativeTokenUsage = (
  cumulativeUsage: Record<string, number>,
  turnId?: string,
): AgentTokenUsageEvidence => ({
  kind: "token-usage",
  cumulativeUsage,
  ...(turnId === undefined ? {} : { turnId }),
});

export const itemById = (
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

export const userItemById = (model: AgentTrajectoryModel, id: string): AgentTrajectoryUserItem => {
  for (const item of model.items) {
    if (item.id === id && item.kind === "user") {
      return item;
    }
  }
  throw new Error(`Missing user trajectory item ${id}`);
};

export const toolItems = (model: AgentTrajectoryModel) => {
  const items: Extract<AgentTrajectoryItem, { kind: "tool" }>[] = [];
  for (const item of model.items) {
    if (item.kind === "tool") {
      items.push(item);
    }
  }
  return items;
};

export const warningKinds = (model: AgentTrajectoryModel) => {
  const kinds: string[] = [];
  for (const warning of model.warnings) {
    kinds.push(warning.kind);
  }
  return kinds;
};

export const trajectoryTurnId = (
  source: "evidence" | "fallback-index" | "synthetic-event",
  value: string | number,
) => JSON.stringify([source, value]);

export const assertTrajectoryOutputIsReadonly = (model: AgentTrajectoryModel) => {
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

export const assertTrajectorySelectionsCannotNest = () => {
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
