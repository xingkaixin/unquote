import type {
  AgentCanonicalSelection,
  AgentSession,
  AgentToolCallEvidence,
  AgentToolCompletionEvidence,
  AgentToolResultEvidence,
  AgentTrajectoryAssistantReasoningItem,
  AgentTrajectoryCompactionItem,
  AgentSessionEvidence,
  AgentTrajectoryItem,
  AgentTrajectoryItemBase,
  AgentTrajectoryModel,
  AgentTrajectorySystemItem,
  AgentTrajectoryStatus,
  AgentTrajectorySubagentItem,
  AgentTrajectoryTokenUsage,
  AgentTrajectoryToolItem,
  AgentTrajectoryTurn,
  AgentTrajectoryUserItem,
  AgentTrajectoryWarning,
  AgentTimelineEvent,
} from "./types";
import { canonicalizeAgentSession, type CanonicalAgentSession } from "./identity";
import {
  createAgentToolLifecycleIndex,
  resolveToolLifecycleStatus,
  type AgentToolLifecycleGroup,
  type AgentToolLifecycleIndex,
} from "./tool-lifecycle";
import {
  hasRepeatedToolOccurrences,
  toolCorrelationScope,
  type ToolCorrelationGroup,
} from "./tool-correlation";

const tokenKeys = [
  "inputTokens",
  "cacheCreationInputTokens",
  "cacheReadInputTokens",
  "outputTokens",
  "reasoningOutputTokens",
] as const;

type AgentTrajectoryTokenUsageDraft = Partial<Record<(typeof tokenKeys)[number], number>>;

interface WarningSource {
  recordId: string;
  lineNumber: number;
  selection: AgentCanonicalSelection;
  turnIndex?: number;
}

interface TurnDraft {
  id: string;
  warningTurnId: string;
  status: AgentTrajectoryStatus;
  firstSource: WarningSource;
  hasTerminalLifecycle: boolean;
  pendingToolRecovery: boolean;
  nextStepIndex: number;
  turnIndex?: number;
  lifecycleStartSource?: WarningSource;
  lifecycleStartTimestamp?: number;
  terminalLifecycleSource?: WarningSource;
  terminalLifecycleTimestamp?: number;
  explicitDurationMs?: number;
  earliestNonTerminalTimestamp?: number;
}

interface ItemDraft {
  turn: TurnDraft | null;
  item: AgentTrajectoryItem | null;
}

interface ToolOccurrenceBase<
  TEvidence extends AgentToolCallEvidence | AgentToolResultEvidence | AgentToolCompletionEvidence,
> {
  evidence: TEvidence;
  itemId: string;
  selection: AgentCanonicalSelection;
  source: WarningSource;
  timestamp: number | undefined;
  draft: ItemDraft;
  event: AgentTimelineEvent;
}

type ToolCallOccurrence = ToolOccurrenceBase<AgentToolCallEvidence>;
type ToolResultOccurrence = ToolOccurrenceBase<AgentToolResultEvidence>;
type ToolCompletionOccurrence = ToolOccurrenceBase<AgentToolCompletionEvidence>;
type ToolTerminalOccurrence = ToolResultOccurrence | ToolCompletionOccurrence;

type ToolGroup = ToolCorrelationGroup<
  ToolCallOccurrence,
  ToolResultOccurrence,
  ToolCompletionOccurrence
>;

type TurnLifecycleEvidence = Extract<AgentSessionEvidence, { kind: "turn-lifecycle" }>;
type ModelOutputEvidence = Extract<AgentSessionEvidence, { kind: "model-output" }>;
type ToolLifecycleEvidence = Extract<AgentSessionEvidence, { kind: "tool-lifecycle" }>;
type TokenUsageEvidence = Extract<AgentSessionEvidence, { kind: "token-usage" }>;

interface TrajectoryDraftState {
  turns: TurnDraft[];
  explicitTurnById: Map<string, TurnDraft>;
  fallbackTurnByIndex: Map<number, TurnDraft>;
  syntheticTurnByEventId: Map<string, TurnDraft>;
  toolGroups: Map<AgentToolLifecycleGroup, ToolGroup>;
  itemDrafts: ItemDraft[];
  warnings: AgentTrajectoryWarning[];
  lastModelItemByTurn: Map<TurnDraft, ItemDraft>;
  totalTokenUsage: AgentTrajectoryTokenUsageDraft;
}

interface EvidenceContext {
  event: AgentTimelineEvent;
  itemId: string;
  selection: AgentCanonicalSelection;
  source: WarningSource;
  turn: TurnDraft | null;
}

type TrajectoryTurnScope =
  | Exclude<ReturnType<typeof toolCorrelationScope>, { source: "anonymous" }>
  | { readonly source: "synthetic-event"; readonly value: string };

const syntheticTurnScope = (eventId: string): TrajectoryTurnScope => ({
  source: "synthetic-event",
  value: eventId,
});

const trajectoryTurnId = (scope: TrajectoryTurnScope) =>
  JSON.stringify([scope.source, scope.value]);

const toolOccurrenceFor = <
  TEvidence extends AgentToolCallEvidence | AgentToolResultEvidence | AgentToolCompletionEvidence,
>(
  evidence: TEvidence,
  itemId: string,
  selection: AgentCanonicalSelection,
  source: WarningSource,
  event: AgentTimelineEvent,
  draft: ItemDraft,
): ToolOccurrenceBase<TEvidence> => ({
  evidence,
  itemId,
  selection,
  source,
  timestamp: finiteNumber(event.timestamp),
  draft,
  event,
});

const finiteNumber = (value: number | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const finiteTurnIndex = (value: number | undefined) =>
  typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;

const nonEmptyString = (value: string | undefined) =>
  value && value.length > 0 ? value : undefined;

const nonNegativeDuration = (value: number | undefined) => {
  const duration = finiteNumber(value);
  return duration !== undefined && duration >= 0 ? duration : undefined;
};

const safeTokenCount = (value: number | undefined) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

const optionalEventFields = (event: AgentTimelineEvent) => {
  const timestamp = finiteNumber(event.timestamp);
  const turnIndex = finiteTurnIndex(event.turnIndex);
  return {
    ...(timestamp === undefined ? {} : { timestamp }),
    ...(turnIndex === undefined ? {} : { turnIndex }),
  };
};

const selectionFor = (
  event: AgentTimelineEvent,
  conversationItemId: string | undefined,
  canonicalConversationIds: ReadonlySet<string>,
): AgentCanonicalSelection => {
  if (conversationItemId && canonicalConversationIds.has(conversationItemId)) {
    return { kind: "conversation", id: conversationItemId, recordId: event.recordId };
  }
  return { kind: "event", id: event.id, recordId: event.recordId };
};

const warningSourceFor = (
  event: AgentTimelineEvent,
  selection: AgentCanonicalSelection,
): WarningSource => {
  const turnIndex = finiteTurnIndex(event.turnIndex);
  return {
    recordId: event.recordId,
    lineNumber: event.lineNumber,
    selection,
    ...(turnIndex === undefined ? {} : { turnIndex }),
  };
};

const itemIdFor = (event: AgentTimelineEvent, evidenceIndex: number) =>
  `${event.id}:evidence-${evidenceIndex}`;

const baseItem = <TKind extends AgentTrajectoryItem["kind"], TStatus extends AgentTrajectoryStatus>(
  id: string,
  kind: TKind,
  status: TStatus,
  event: AgentTimelineEvent,
  selection: AgentCanonicalSelection,
): AgentTrajectoryItemBase<TKind, TStatus> => ({
  id,
  kind,
  status,
  recordId: event.recordId,
  lineNumber: event.lineNumber,
  selection,
  ...optionalEventFields(event),
});

const validTokenUsage = (
  usage: AgentTrajectoryTokenUsage | undefined,
): AgentTrajectoryTokenUsageDraft | undefined => {
  if (!usage) {
    return undefined;
  }

  const valid: AgentTrajectoryTokenUsageDraft = {};
  let hasComponent = false;

  for (const key of tokenKeys) {
    const value = safeTokenCount(usage[key]);
    if (value !== undefined) {
      valid[key] = value;
      hasComponent = true;
    }
  }

  return hasComponent ? valid : undefined;
};

const mergeTokenUsage = (
  current: AgentTrajectoryTokenUsage | undefined,
  next: AgentTrajectoryTokenUsage,
): AgentTrajectoryTokenUsageDraft | undefined => {
  const merged: AgentTrajectoryTokenUsageDraft = current ? { ...current } : {};
  let hasComponent = false;

  for (const key of tokenKeys) {
    if (merged[key] !== undefined) {
      hasComponent = true;
    }
    const value = next[key];
    if (value === undefined) {
      continue;
    }
    const existing = merged[key];
    const total = existing === undefined ? value : existing + value;
    if (!Number.isSafeInteger(total)) {
      continue;
    }
    merged[key] = total;
    hasComponent = true;
  }

  return hasComponent ? merged : undefined;
};

const mergeTotalTokenUsage = (
  total: AgentTrajectoryTokenUsageDraft,
  usage: AgentTrajectoryTokenUsageDraft | undefined,
  cumulativeUsage: AgentTrajectoryTokenUsageDraft | undefined,
) => {
  for (const key of tokenKeys) {
    const cumulativeValue = cumulativeUsage?.[key];
    if (cumulativeValue !== undefined) {
      total[key] = cumulativeValue;
      continue;
    }

    const usageValue = usage?.[key];
    if (usageValue === undefined) {
      continue;
    }

    const existing = total[key];
    const next = existing === undefined ? usageValue : existing + usageValue;
    if (Number.isSafeInteger(next)) {
      total[key] = next;
    }
  }
};

const addUnpairedCallWarning = (
  warnings: AgentTrajectoryWarning[],
  occurrence: ToolCallOccurrence,
) => {
  const callId = nonEmptyString(occurrence.evidence.callId);
  warnings.push({
    ...occurrence.source,
    kind: "unpaired-tool-call",
    ...(callId === undefined ? {} : { callId }),
  });
};

const addUnpairedResultWarning = (
  warnings: AgentTrajectoryWarning[],
  occurrence: ToolResultOccurrence,
) => {
  const callId = nonEmptyString(occurrence.evidence.callId);
  warnings.push({
    ...occurrence.source,
    kind: "unpaired-tool-result",
    ...(callId === undefined ? {} : { callId }),
  });
};

const addUnpairedCompletionWarning = (
  warnings: AgentTrajectoryWarning[],
  occurrence: ToolCompletionOccurrence,
) => {
  const callId = nonEmptyString(occurrence.evidence.callId);
  warnings.push({
    ...occurrence.source,
    kind: "unpaired-tool-completion",
    ...(callId === undefined ? {} : { callId }),
  });
};

const toolStatusFor = (
  result: ToolResultOccurrence | undefined,
  completion: ToolCompletionOccurrence | undefined,
): AgentTrajectoryToolItem["status"] => {
  const status = resolveToolLifecycleStatus(result?.evidence.status, completion?.evidence.status);
  return status === "pending" ? "running" : status;
};

const toolEndpointFor = (occurrence: ToolTerminalOccurrence) => occurrence.evidence.phase;

const toolItemFor = (
  call: ToolCallOccurrence | undefined,
  result: ToolResultOccurrence | undefined,
  completion: ToolCompletionOccurrence | undefined,
  warnings: AgentTrajectoryWarning[],
): AgentTrajectoryToolItem => {
  const primary = call ?? result ?? completion;
  if (!primary) {
    throw new Error("Tool correlation group requires an occurrence");
  }

  const terminal = completion?.timestamp === undefined ? (result ?? completion) : completion;
  const callId = nonEmptyString(
    call?.evidence.callId ?? result?.evidence.callId ?? completion?.evidence.callId,
  );
  const endedAt = terminal?.timestamp;
  const item: AgentTrajectoryToolItem = {
    ...baseItem(
      primary.itemId,
      "tool",
      toolStatusFor(result, completion),
      primary.event,
      primary.selection,
    ),
    ...(call?.evidence.toolName ? { toolName: call.evidence.toolName } : {}),
    ...(callId === undefined ? {} : { callId }),
    ...(call === undefined ? {} : { callSelection: call.selection }),
    ...(result === undefined ? {} : { resultSelection: result.selection }),
    ...(completion === undefined ? {} : { completionSelection: completion.selection }),
    ...(call?.timestamp === undefined ? {} : { startedAt: call.timestamp }),
    ...(endedAt === undefined ? {} : { endedAt }),
  };

  const explicitDuration =
    nonNegativeDuration(completion?.evidence.durationMs) ??
    nonNegativeDuration(result?.evidence.durationMs);
  if (!call || !terminal) {
    return explicitDuration === undefined ? item : { ...item, durationMs: explicitDuration };
  }

  let derivedDuration: number | undefined;
  const missingCompletion = completion?.timestamp === undefined ? completion : undefined;
  if (call.timestamp === undefined) {
    warnings.push({
      ...call.source,
      kind: "missing-timestamp",
      subject: "tool",
      endpoint: "call",
      ...(callId === undefined ? {} : { callId }),
    });
  }
  if (missingCompletion) {
    warnings.push({
      ...missingCompletion.source,
      kind: "missing-timestamp",
      subject: "tool",
      endpoint: "completion",
      ...(callId === undefined ? {} : { callId }),
    });
  }
  if (call.timestamp === undefined || terminal.timestamp === undefined) {
    if (!missingCompletion && terminal.timestamp === undefined) {
      warnings.push({
        ...terminal.source,
        kind: "missing-timestamp",
        subject: "tool",
        endpoint: toolEndpointFor(terminal),
        ...(callId === undefined ? {} : { callId }),
      });
    }
  } else if (terminal.timestamp < call.timestamp) {
    warnings.push({
      ...terminal.source,
      kind: "reversed-timestamp",
      subject: "tool",
      ...(callId === undefined ? {} : { callId }),
    });
  } else {
    derivedDuration = nonNegativeDuration(terminal.timestamp - call.timestamp);
  }

  const duration = explicitDuration ?? derivedDuration;
  return duration === undefined ? item : { ...item, durationMs: duration };
};

const addDuplicateWarning = (
  warnings: AgentTrajectoryWarning[],
  occurrence: ToolCallOccurrence | ToolResultOccurrence | ToolCompletionOccurrence,
) => {
  const callId = nonEmptyString(occurrence.evidence.callId);
  if (!callId) {
    return;
  }

  const kind =
    occurrence.evidence.phase === "call"
      ? "duplicate-tool-call-id"
      : occurrence.evidence.phase === "result"
        ? "duplicate-tool-result-id"
        : "duplicate-tool-completion-id";
  warnings.push({ ...occurrence.source, kind, callId });
};

const addDuplicateWarnings = (group: ToolGroup, warnings: AgentTrajectoryWarning[]) => {
  for (const occurrences of [group.calls, group.results, group.completions]) {
    for (let index = 1; index < occurrences.length; index += 1) {
      addDuplicateWarning(warnings, occurrences[index]!);
    }
  }
};

const finalizeToolGroup = (group: ToolGroup, warnings: AgentTrajectoryWarning[]) => {
  if (hasRepeatedToolOccurrences(group)) {
    addDuplicateWarnings(group, warnings);
    for (const call of group.calls) {
      call.draft.item = toolItemFor(call, undefined, undefined, warnings);
      addUnpairedCallWarning(warnings, call);
    }
    for (const result of group.results) {
      result.draft.item = toolItemFor(undefined, result, undefined, warnings);
      addUnpairedResultWarning(warnings, result);
    }
    for (const completion of group.completions) {
      completion.draft.item = toolItemFor(undefined, undefined, completion, warnings);
      addUnpairedCompletionWarning(warnings, completion);
    }
    return;
  }

  const call = group.calls[0];
  const result = group.results[0];
  const completion = group.completions[0];
  const item = toolItemFor(call, result, completion, warnings);

  if (call) {
    call.draft.item = item;
    if (!result && !completion) {
      addUnpairedCallWarning(warnings, call);
    }
    return;
  }
  if (result) {
    result.draft.item = item;
    addUnpairedResultWarning(warnings, result);
    return;
  }
  if (completion) {
    completion.draft.item = item;
    addUnpairedCompletionWarning(warnings, completion);
  }
};

const conversationItemIdFor = (evidence: AgentSessionEvidence) => {
  if (evidence.kind === "model-output") {
    return evidence.conversationItemId;
  }
  return evidence.kind === "tool-lifecycle" && evidence.phase !== "completion"
    ? evidence.conversationItemId
    : undefined;
};

const terminalLifecycle = (evidence: AgentSessionEvidence) =>
  evidence.kind === "turn-lifecycle" && evidence.phase !== "start";

const createTrajectoryDraftState = (): TrajectoryDraftState => ({
  turns: [],
  explicitTurnById: new Map(),
  fallbackTurnByIndex: new Map(),
  syntheticTurnByEventId: new Map(),
  toolGroups: new Map(),
  itemDrafts: [],
  warnings: [],
  lastModelItemByTurn: new Map(),
  totalTokenUsage: {},
});

const createTurnDraft = (
  state: TrajectoryDraftState,
  scope: TrajectoryTurnScope,
  turnIndex: number | undefined,
  event: AgentTimelineEvent,
  selection: AgentCanonicalSelection,
) => {
  const id = trajectoryTurnId(scope);
  const draft: TurnDraft = {
    id,
    warningTurnId: scope.source === "evidence" ? scope.value : id,
    status: "running",
    firstSource: warningSourceFor(event, selection),
    hasTerminalLifecycle: false,
    pendingToolRecovery: false,
    nextStepIndex: 1,
    ...(turnIndex === undefined ? {} : { turnIndex }),
  };
  state.turns.push(draft);
  return draft;
};

const resolveTurnDraft = (
  state: TrajectoryDraftState,
  event: AgentTimelineEvent,
  evidence: AgentSessionEvidence,
  selection: AgentCanonicalSelection,
) => {
  const turnIndex = finiteTurnIndex(event.turnIndex);
  const scope = toolCorrelationScope(evidence.turnId, turnIndex);
  if (scope.source === "evidence") {
    let turn = state.explicitTurnById.get(scope.value);
    if (!turn) {
      turn = createTurnDraft(state, scope, turnIndex, event, selection);
      state.explicitTurnById.set(scope.value, turn);
    }
    if (turn.turnIndex === undefined && turnIndex !== undefined) {
      turn.turnIndex = turnIndex;
    }
    return turn;
  }
  if (scope.source === "fallback-index") {
    let turn = state.fallbackTurnByIndex.get(scope.value);
    if (!turn) {
      turn = createTurnDraft(state, scope, turnIndex, event, selection);
      state.fallbackTurnByIndex.set(scope.value, turn);
    }
    return turn;
  }
  if (evidence.kind !== "turn-lifecycle") {
    return null;
  }

  let turn = state.syntheticTurnByEventId.get(event.id);
  if (!turn) {
    turn = createTurnDraft(state, syntheticTurnScope(event.id), undefined, event, selection);
    state.syntheticTurnByEventId.set(event.id, turn);
  }
  return turn;
};

const observeEarliestNonTerminalTimestamp = (turn: TurnDraft, event: AgentTimelineEvent) => {
  const timestamp = finiteNumber(event.timestamp);
  if (timestamp === undefined) {
    return;
  }
  const current = turn.earliestNonTerminalTimestamp;
  if (current === undefined || timestamp < current) {
    turn.earliestNonTerminalTimestamp = timestamp;
  }
};

const observeTurnLifecycle = (evidence: TurnLifecycleEvidence, context: EvidenceContext) => {
  const { turn } = context;
  if (!turn) {
    return;
  }
  const timestamp = finiteNumber(evidence.timestamp) ?? finiteNumber(context.event.timestamp);
  if (evidence.phase === "start") {
    turn.lifecycleStartSource = context.source;
    if (timestamp !== undefined) {
      turn.lifecycleStartTimestamp = timestamp;
    }
    return;
  }

  turn.hasTerminalLifecycle = true;
  turn.terminalLifecycleSource = context.source;
  turn.status = evidence.phase === "complete" ? "completed" : evidence.phase;
  if (timestamp !== undefined) {
    turn.terminalLifecycleTimestamp = timestamp;
  }
  const explicitDuration = nonNegativeDuration(evidence.durationMs);
  if (explicitDuration !== undefined) {
    turn.explicitDurationMs = explicitDuration;
  }
};

const derivedStepFor = (turn: TurnDraft | null) => {
  if (!turn?.pendingToolRecovery) {
    return undefined;
  }
  const step = { index: turn.nextStepIndex, source: "derived" as const };
  turn.nextStepIndex += 1;
  turn.pendingToolRecovery = false;
  return step;
};

const appendModelOutput = (
  state: TrajectoryDraftState,
  evidence: ModelOutputEvidence,
  context: EvidenceContext,
) => {
  if (evidence.role === "user") {
    const item: AgentTrajectoryUserItem = {
      ...baseItem(context.itemId, "user", "completed", context.event, context.selection),
    };
    state.itemDrafts.push({ turn: context.turn, item });
    return;
  }
  if (evidence.role === "system") {
    const item: AgentTrajectorySystemItem = {
      ...baseItem(context.itemId, "system", "completed", context.event, context.selection),
    };
    state.itemDrafts.push({ turn: context.turn, item });
    return;
  }

  const step = derivedStepFor(context.turn);
  const item: AgentTrajectoryAssistantReasoningItem = {
    ...baseItem(context.itemId, evidence.role, "completed", context.event, context.selection),
    ...(step === undefined ? {} : { step }),
  };
  const draft = { turn: context.turn, item };
  state.itemDrafts.push(draft);
  if (context.turn) {
    state.lastModelItemByTurn.set(context.turn, draft);
  }
};

const appendUngroupedTool = (
  state: TrajectoryDraftState,
  evidence: ToolLifecycleEvidence,
  context: EvidenceContext,
  draft: ItemDraft,
) => {
  if (evidence.phase === "call") {
    const occurrence = toolOccurrenceFor(
      evidence,
      context.itemId,
      context.selection,
      context.source,
      context.event,
      draft,
    );
    draft.item = toolItemFor(occurrence, undefined, undefined, state.warnings);
    addUnpairedCallWarning(state.warnings, occurrence);
    return;
  }
  if (evidence.phase === "result") {
    const occurrence = toolOccurrenceFor(
      evidence,
      context.itemId,
      context.selection,
      context.source,
      context.event,
      draft,
    );
    draft.item = toolItemFor(undefined, occurrence, undefined, state.warnings);
    addUnpairedResultWarning(state.warnings, occurrence);
    return;
  }

  const occurrence = toolOccurrenceFor(
    evidence,
    context.itemId,
    context.selection,
    context.source,
    context.event,
    draft,
  );
  draft.item = toolItemFor(undefined, undefined, occurrence, state.warnings);
  addUnpairedCompletionWarning(state.warnings, occurrence);
};

const groupedToolOccurrence = <TEvidence extends ToolLifecycleEvidence>(
  evidence: TEvidence,
  context: EvidenceContext,
  draft: ItemDraft,
) =>
  toolOccurrenceFor(
    evidence,
    context.itemId,
    context.selection,
    context.source,
    context.event,
    draft,
  );

const appendToolLifecycle = (
  state: TrajectoryDraftState,
  toolLifecycle: AgentToolLifecycleIndex,
  evidence: ToolLifecycleEvidence,
  context: EvidenceContext,
) => {
  const draft: ItemDraft = { turn: context.turn, item: null };
  state.itemDrafts.push(draft);
  const lifecycleGroup = toolLifecycle.groupByEvidence.get(evidence);
  if (!lifecycleGroup) {
    appendUngroupedTool(state, evidence, context, draft);
  } else {
    let group = state.toolGroups.get(lifecycleGroup);
    if (!group) {
      group = { calls: [], results: [], completions: [] };
      state.toolGroups.set(lifecycleGroup, group);
    }
    if (evidence.phase === "call") {
      group.calls.push(groupedToolOccurrence(evidence, context, draft));
    } else if (evidence.phase === "result") {
      group.results.push(groupedToolOccurrence(evidence, context, draft));
    } else {
      group.completions.push(groupedToolOccurrence(evidence, context, draft));
    }
  }
  if (evidence.phase !== "call" && context.turn) {
    context.turn.pendingToolRecovery = true;
  }
};

const observeTokenUsage = (
  state: TrajectoryDraftState,
  evidence: TokenUsageEvidence,
  context: EvidenceContext,
) => {
  const usage = validTokenUsage(evidence.usage);
  const cumulativeUsage = validTokenUsage(evidence.cumulativeUsage);
  mergeTotalTokenUsage(state.totalTokenUsage, usage, cumulativeUsage);
  if (evidence.usage === undefined) {
    return;
  }

  const previousDraft = context.turn ? state.lastModelItemByTurn.get(context.turn) : undefined;
  const previous = previousDraft?.item;
  if (
    !previousDraft ||
    !previous ||
    (previous.kind !== "assistant" && previous.kind !== "reasoning")
  ) {
    state.warnings.push({ ...context.source, kind: "unattached-token-usage" });
    return;
  }
  if (usage) {
    const mergedUsage = mergeTokenUsage(previous.tokenUsage, usage);
    if (mergedUsage) {
      previousDraft.item = { ...previous, tokenUsage: mergedUsage };
    }
  }
};

const appendEvidence = (
  state: TrajectoryDraftState,
  toolLifecycle: AgentToolLifecycleIndex,
  evidence: AgentSessionEvidence,
  context: EvidenceContext,
) => {
  if (evidence.kind === "turn-lifecycle") {
    observeTurnLifecycle(evidence, context);
  } else if (evidence.kind === "model-output") {
    appendModelOutput(state, evidence, context);
  } else if (evidence.kind === "tool-lifecycle") {
    appendToolLifecycle(state, toolLifecycle, evidence, context);
  } else if (evidence.kind === "token-usage") {
    observeTokenUsage(state, evidence, context);
  } else if (evidence.kind === "subagent-activity") {
    const item: AgentTrajectorySubagentItem = {
      ...baseItem(context.itemId, "subagent", evidence.status, context.event, context.selection),
    };
    state.itemDrafts.push({ turn: context.turn, item });
  } else {
    const item: AgentTrajectoryCompactionItem = {
      ...baseItem(context.itemId, "compaction", "completed", context.event, context.selection),
    };
    state.itemDrafts.push({ turn: context.turn, item });
  }
};

const collectEvidence = (state: TrajectoryDraftState, toolLifecycle: AgentToolLifecycleIndex) => {
  for (const {
    evidence: evidenceList,
    canonicalEvent: { event, conversationItemIds },
  } of toolLifecycle.evidenceEvents) {
    let evidenceIndex = 0;
    for (const evidence of evidenceList) {
      const selection = selectionFor(event, conversationItemIdFor(evidence), conversationItemIds);
      const turn = resolveTurnDraft(state, event, evidence, selection);
      if (turn && !terminalLifecycle(evidence)) {
        observeEarliestNonTerminalTimestamp(turn, event);
      }
      appendEvidence(state, toolLifecycle, evidence, {
        event,
        itemId: itemIdFor(event, evidenceIndex),
        selection,
        source: warningSourceFor(event, selection),
        turn,
      });
      evidenceIndex += 1;
    }
  }
};

const finalizeToolGroups = (
  state: TrajectoryDraftState,
  toolLifecycle: AgentToolLifecycleIndex,
) => {
  for (const lifecycleGroup of toolLifecycle.groups) {
    const group = state.toolGroups.get(lifecycleGroup);
    if (group) {
      finalizeToolGroup(group, state.warnings);
    }
  }
};

const materializeItems = (drafts: readonly ItemDraft[]) => {
  const items: AgentTrajectoryItem[] = [];
  for (const draft of drafts) {
    if (draft.item) {
      items.push(draft.turn ? { ...draft.item, turnId: draft.turn.id } : draft.item);
    }
  }
  return items;
};

const materializeTurn = (turn: TurnDraft, warnings: AgentTrajectoryWarning[]) => {
  const startedAt = turn.lifecycleStartSource
    ? turn.lifecycleStartTimestamp
    : turn.earliestNonTerminalTimestamp;
  const endedAt = turn.terminalLifecycleSource ? turn.terminalLifecycleTimestamp : undefined;
  let durationMs: number | undefined;

  if (turn.hasTerminalLifecycle) {
    if (turn.lifecycleStartSource) {
      if (startedAt === undefined) {
        warnings.push({
          ...turn.lifecycleStartSource,
          kind: "missing-timestamp",
          subject: "turn",
          endpoint: "start",
          turnId: turn.warningTurnId,
        });
      }
    } else if (turn.earliestNonTerminalTimestamp === undefined && turn.terminalLifecycleSource) {
      warnings.push({
        ...turn.terminalLifecycleSource,
        kind: "missing-turn-start",
        turnId: turn.warningTurnId,
      });
    }
    if (endedAt === undefined && turn.terminalLifecycleSource) {
      warnings.push({
        ...turn.terminalLifecycleSource,
        kind: "missing-timestamp",
        subject: "turn",
        endpoint: "terminal",
        turnId: turn.warningTurnId,
      });
    }
    if (startedAt !== undefined && endedAt !== undefined) {
      if (endedAt < startedAt) {
        warnings.push({
          ...turn.terminalLifecycleSource!,
          kind: "reversed-timestamp",
          subject: "turn",
          turnId: turn.warningTurnId,
        });
      } else {
        durationMs = nonNegativeDuration(endedAt - startedAt);
      }
    }
    durationMs = turn.explicitDurationMs ?? durationMs;
  } else {
    warnings.push({ ...turn.firstSource, kind: "open-turn", turnId: turn.warningTurnId });
  }

  return {
    id: turn.id,
    status: turn.status,
    ...(turn.turnIndex === undefined ? {} : { turnIndex: turn.turnIndex }),
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(endedAt === undefined ? {} : { endedAt }),
    ...(durationMs === undefined ? {} : { durationMs }),
  } satisfies AgentTrajectoryTurn;
};

export const createAgentTrajectoryModelFromCanonicalSession = (
  session: CanonicalAgentSession,
  toolLifecycle: AgentToolLifecycleIndex = createAgentToolLifecycleIndex(session),
): AgentTrajectoryModel => {
  const state = createTrajectoryDraftState();
  collectEvidence(state, toolLifecycle);
  finalizeToolGroups(state, toolLifecycle);
  return {
    turns: state.turns.map((turn) => materializeTurn(turn, state.warnings)),
    items: materializeItems(state.itemDrafts),
    warnings: state.warnings,
    stats: { tokenUsage: state.totalTokenUsage },
  };
};

export const createAgentTrajectoryModel = (session: AgentSession): AgentTrajectoryModel =>
  createAgentTrajectoryModelFromCanonicalSession(canonicalizeAgentSession(session));
