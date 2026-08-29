import type { AgentCanonicalSelection } from "../src/lib/agent-session/session-types";
import {
  type AgentDetailSelection,
  type AgentSessionDetail,
  type AgentSessionModel,
  type AgentTimelineEvent,
  type AgentTrajectoryItem,
  type AgentTrajectoryModel,
  type AgentTrajectoryStatus,
  type AgentTrajectoryTurn,
  type AgentTrajectoryWarning,
} from "../src/lib/agent-session";

export const isWellFormed = (value: string) =>
  (String.prototype as unknown as { isWellFormed: (this: string) => boolean }).isWellFormed.call(
    value,
  );

export const selectionFor = (id: string): AgentCanonicalSelection => ({
  kind: "event",
  id,
  recordId: `record-${id}`,
});

export const eventFor = (id: string, label: string, preview: string): AgentTimelineEvent => ({
  id,
  recordId: `record-${id}`,
  lineNumber: Number(id.replace(/\D/g, "")) || 1,
  category: "assistant",
  kind: "message",
  label,
  preview,
  conversationItems: [],
});

export const assistantItemFor = (id: string): AgentTrajectoryItem => ({
  id: `item-${id}`,
  kind: "assistant",
  status: "completed",
  recordId: `record-${id}`,
  lineNumber: Number(id.replace(/\D/g, "")) || 1,
  selection: selectionFor(id),
});

export const modelOutputItemFor = (
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

export const toolItemFor = (
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

export type TrajectoryTurnInput = AgentTrajectoryTurn & {
  readonly sourceItems?: readonly AgentTrajectoryItem[];
};

export const turnFor = (
  id: string,
  items: readonly AgentTrajectoryItem[],
  options: {
    status?: AgentTrajectoryStatus;
    startedAt?: number;
    endedAt?: number;
    durationMs?: number;
    turnIndex?: number;
  } = {},
): TrajectoryTurnInput => ({
  id,
  status: options.status ?? "completed",
  sourceItems: items,
  ...(options.startedAt === undefined ? {} : { startedAt: options.startedAt }),
  ...(options.endedAt === undefined ? {} : { endedAt: options.endedAt }),
  ...(options.durationMs === undefined ? {} : { durationMs: options.durationMs }),
  ...(options.turnIndex === undefined ? {} : { turnIndex: options.turnIndex }),
});

export const modelFor = (
  events: readonly AgentTimelineEvent[],
  items: readonly AgentTrajectoryItem[],
  turns: readonly TrajectoryTurnInput[] = [],
  warnings: readonly AgentTrajectoryWarning[] = [],
  tokenUsage: AgentTrajectoryModel["stats"]["tokenUsage"] = {},
): AgentSessionModel => {
  const eventById = new Map(events.map((event) => [event.id, event]));
  const eventByRecordId = new Map(events.map((event) => [event.recordId, event]));
  const turnIdByItem = new Map<AgentTrajectoryItem, string>();
  const canonicalTurns = turns.map(({ sourceItems, ...turn }) => {
    for (const item of sourceItems ?? []) {
      turnIdByItem.set(item, turn.id);
    }
    return turn;
  });
  const canonicalItems = items.map((item) => {
    const turnId = turnIdByItem.get(item);
    return turnId === undefined ? item : { ...item, turnId };
  });
  const trajectory: AgentTrajectoryModel = {
    turns: canonicalTurns,
    items: canonicalItems,
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
    turnCount: canonicalTurns.length,
    trajectory,
    resolveDetail,
    selectEvent: (id) => (eventById.has(id) ? selectionFor(id) : null),
    selectConversation: () => null,
    selectTrajectory: () => null,
    resolveToolStatus: () => "pending",
    resolveToolName: () => undefined,
  };
};

export const warningGroupsFor = (warnings: readonly AgentTrajectoryWarning[]) =>
  warnings.map((warning) => ({ warning, count: 1 }));

export const warningForKind = (
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
