import type {
  AgentCanonicalSelection,
  AgentSession,
  AgentToolCallEvidence,
  AgentToolCompletionEvidence,
  AgentToolResultEvidence,
  AgentTrajectoryAssistantReasoningItem,
  AgentTrajectoryCompactionItem,
  AgentTrajectoryEvidence,
  AgentTrajectoryItem,
  AgentTrajectoryItemBase,
  AgentTrajectoryModel,
  AgentTrajectorySystemItem,
  AgentTrajectoryStatus,
  AgentTrajectorySubagentItem,
  AgentTrajectoryTokenUsage,
  AgentTrajectoryTokenUsageSnapshot,
  AgentTrajectoryToolItem,
  AgentTrajectoryTurn,
  AgentTrajectoryUserItem,
  AgentTrajectoryWarning,
  AgentTimelineEvent,
} from "./types";
import {
  createToolCorrelationGroups,
  forEachToolCorrelationGroup,
  syntheticTurnScope,
  toolCorrelationGroupFor,
  toolCorrelationScope,
  trajectoryTurnId,
  type ToolCorrelationGroup,
  type TrajectoryTurnScope,
} from "./tool-correlation";

const tokenKeys = [
  "inputTokens",
  "cacheCreationInputTokens",
  "cacheReadInputTokens",
  "outputTokens",
  "reasoningOutputTokens",
] as const;

interface AgentTrajectoryTokenUsageDraft {
  inputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
}

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
  items: AgentTrajectoryItem[];
  firstSource: WarningSource;
  hasTerminalLifecycle: boolean;
  pendingToolRecovery: boolean;
  nextStepIndex: number;
  turnIndex?: number;
  lifecycleStartSource?: WarningSource;
  lifecycleStartTimestamp?: number;
  terminalLifecycleSource?: WarningSource;
  terminalLifecycleTimestamp?: number;
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
  current: AgentTrajectoryTokenUsageSnapshot | undefined,
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
  if (result?.evidence.status === "failed" || completion?.evidence.status === "failed") {
    return "failed";
  }
  if (result?.evidence.status === "completed" || completion?.evidence.status === "completed") {
    return "completed";
  }
  return "running";
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

const hasRepeatedToolOccurrence = (group: ToolGroup) =>
  group.calls.length > 1 || group.results.length > 1 || group.completions.length > 1;

const addDuplicateWarnings = (group: ToolGroup, warnings: AgentTrajectoryWarning[]) => {
  for (const occurrences of [group.calls, group.results, group.completions]) {
    for (let index = 1; index < occurrences.length; index += 1) {
      addDuplicateWarning(warnings, occurrences[index]!);
    }
  }
};

const finalizeToolGroup = (group: ToolGroup, warnings: AgentTrajectoryWarning[]) => {
  if (hasRepeatedToolOccurrence(group)) {
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

const conversationItemIdFor = (evidence: AgentTrajectoryEvidence) => {
  if (evidence.kind === "model-output") {
    return evidence.conversationItemId;
  }
  return evidence.kind === "tool-lifecycle" && evidence.phase !== "completion"
    ? evidence.conversationItemId
    : undefined;
};

const terminalLifecycle = (evidence: AgentTrajectoryEvidence) =>
  evidence.kind === "turn-lifecycle" && evidence.phase !== "start";

export const createAgentTrajectoryModel = (session: AgentSession): AgentTrajectoryModel => {
  const turns: TurnDraft[] = [];
  const explicitTurnById = new Map<string, TurnDraft>();
  const fallbackTurnByIndex = new Map<number, TurnDraft>();
  const syntheticTurnByEventId = new Map<string, TurnDraft>();
  const toolGroups = createToolCorrelationGroups<
    ToolCallOccurrence,
    ToolResultOccurrence,
    ToolCompletionOccurrence
  >();
  const itemDrafts: ItemDraft[] = [];
  const warnings: AgentTrajectoryWarning[] = [];
  const lastModelItemByTurn = new Map<TurnDraft, ItemDraft>();
  const totalTokenUsage: AgentTrajectoryTokenUsageDraft = {};
  const seenEventIds = new Set<string>();
  const seenRecordIds = new Set<string>();
  const seenConversationIds = new Set<string>();

  const createTurn = (
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
      items: [],
      firstSource: warningSourceFor(event, selection),
      hasTerminalLifecycle: false,
      pendingToolRecovery: false,
      nextStepIndex: 1,
      ...(turnIndex === undefined ? {} : { turnIndex }),
    };
    turns.push(draft);
    return draft;
  };

  const resolveTurn = (
    event: AgentTimelineEvent,
    evidence: AgentTrajectoryEvidence,
    selection: AgentCanonicalSelection,
  ) => {
    const turnIndex = finiteTurnIndex(event.turnIndex);
    const scope = toolCorrelationScope(evidence.turnId, turnIndex);
    if (scope.source === "evidence") {
      let turn = explicitTurnById.get(scope.value);
      if (!turn) {
        turn = createTurn(scope, turnIndex, event, selection);
        explicitTurnById.set(scope.value, turn);
      }
      if (turn.turnIndex === undefined && turnIndex !== undefined) {
        turn.turnIndex = turnIndex;
      }
      return turn;
    }

    if (scope.source === "fallback-index") {
      let turn = fallbackTurnByIndex.get(scope.value);
      if (!turn) {
        turn = createTurn(scope, turnIndex, event, selection);
        fallbackTurnByIndex.set(scope.value, turn);
      }
      return turn;
    }

    if (evidence.kind !== "turn-lifecycle") {
      return null;
    }
    const existing = syntheticTurnByEventId.get(event.id);
    if (existing) {
      return existing;
    }
    const turn = createTurn(syntheticTurnScope(event.id), undefined, event, selection);
    syntheticTurnByEventId.set(event.id, turn);
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

  for (const event of session.events) {
    if (seenEventIds.has(event.id) || seenRecordIds.has(event.recordId)) {
      continue;
    }
    seenEventIds.add(event.id);
    seenRecordIds.add(event.recordId);

    const canonicalConversationIds = new Set<string>();
    for (const item of event.conversationItems) {
      if (!seenConversationIds.has(item.id)) {
        seenConversationIds.add(item.id);
        canonicalConversationIds.add(item.id);
      }
    }

    const evidenceList = event.trajectoryEvidence;
    if (!evidenceList) {
      continue;
    }

    let evidenceIndex = 0;
    for (const evidence of evidenceList) {
      const conversationItemId = conversationItemIdFor(evidence);
      const selection = selectionFor(event, conversationItemId, canonicalConversationIds);
      const source = warningSourceFor(event, selection);
      const turn = resolveTurn(event, evidence, selection);
      if (turn && !terminalLifecycle(evidence)) {
        observeEarliestNonTerminalTimestamp(turn, event);
      }
      const itemId = itemIdFor(event, evidenceIndex);

      if (evidence.kind === "turn-lifecycle") {
        if (turn) {
          const timestamp = finiteNumber(event.timestamp);
          if (evidence.phase === "start") {
            turn.lifecycleStartSource = source;
            if (timestamp !== undefined) {
              turn.lifecycleStartTimestamp = timestamp;
            }
          } else {
            turn.hasTerminalLifecycle = true;
            turn.terminalLifecycleSource = source;
            turn.status = evidence.phase === "complete" ? "completed" : evidence.phase;
            if (timestamp !== undefined) {
              turn.terminalLifecycleTimestamp = timestamp;
            }
          }
        }
      } else if (evidence.kind === "model-output") {
        if (evidence.role === "user") {
          const item: AgentTrajectoryUserItem = {
            ...baseItem(itemId, "user", "completed", event, selection),
          };
          itemDrafts.push({ turn, item });
        } else if (evidence.role === "system") {
          const item: AgentTrajectorySystemItem = {
            ...baseItem(itemId, "system", "completed", event, selection),
          };
          itemDrafts.push({ turn, item });
        } else {
          const step =
            turn && turn.pendingToolRecovery
              ? { index: turn.nextStepIndex, source: "derived" as const }
              : undefined;
          if (step && turn) {
            turn.nextStepIndex += 1;
            turn.pendingToolRecovery = false;
          }
          const item: AgentTrajectoryAssistantReasoningItem = {
            ...baseItem(itemId, evidence.role, "completed", event, selection),
            ...(step === undefined ? {} : { step }),
          };
          const draft = { turn, item };
          itemDrafts.push(draft);
          if (turn) {
            lastModelItemByTurn.set(turn, draft);
          }
        }
      } else if (evidence.kind === "tool-lifecycle") {
        const draft: ItemDraft = { turn, item: null };
        itemDrafts.push(draft);
        const callId = nonEmptyString(evidence.callId);
        if (!callId) {
          if (evidence.phase === "call") {
            const occurrence = toolOccurrenceFor(evidence, itemId, selection, source, event, draft);
            draft.item = toolItemFor(occurrence, undefined, undefined, warnings);
            addUnpairedCallWarning(warnings, occurrence);
          } else if (evidence.phase === "result") {
            const occurrence = toolOccurrenceFor(evidence, itemId, selection, source, event, draft);
            draft.item = toolItemFor(undefined, occurrence, undefined, warnings);
            addUnpairedResultWarning(warnings, occurrence);
            if (turn) {
              turn.pendingToolRecovery = true;
            }
          } else {
            const occurrence = toolOccurrenceFor(evidence, itemId, selection, source, event, draft);
            draft.item = toolItemFor(undefined, undefined, occurrence, warnings);
            addUnpairedCompletionWarning(warnings, occurrence);
            if (turn) {
              turn.pendingToolRecovery = true;
            }
          }
        } else {
          const scope = toolCorrelationScope(evidence.turnId, finiteTurnIndex(event.turnIndex));
          const group = toolCorrelationGroupFor(toolGroups, scope, callId);
          if (evidence.phase === "call") {
            group.calls.push(toolOccurrenceFor(evidence, itemId, selection, source, event, draft));
          } else if (evidence.phase === "result") {
            group.results.push(
              toolOccurrenceFor(evidence, itemId, selection, source, event, draft),
            );
            if (turn) {
              turn.pendingToolRecovery = true;
            }
          } else {
            group.completions.push(
              toolOccurrenceFor(evidence, itemId, selection, source, event, draft),
            );
            if (turn) {
              turn.pendingToolRecovery = true;
            }
          }
        }
      } else if (evidence.kind === "token-usage") {
        const usage = validTokenUsage(evidence.usage);
        const cumulativeUsage = validTokenUsage(evidence.cumulativeUsage);
        mergeTotalTokenUsage(totalTokenUsage, usage, cumulativeUsage);

        if (evidence.usage !== undefined) {
          const previousDraft = turn ? lastModelItemByTurn.get(turn) : undefined;
          const previous = previousDraft?.item;
          if (
            !previousDraft ||
            !previous ||
            (previous.kind !== "assistant" && previous.kind !== "reasoning")
          ) {
            warnings.push({ ...source, kind: "unattached-token-usage" });
          } else if (usage) {
            const mergedUsage = mergeTokenUsage(previous.tokenUsage, usage);
            if (mergedUsage) {
              previousDraft.item = { ...previous, tokenUsage: mergedUsage };
            }
          }
        }
      } else if (evidence.kind === "subagent-activity") {
        const item: AgentTrajectorySubagentItem = {
          ...baseItem(itemId, "subagent", evidence.status, event, selection),
        };
        itemDrafts.push({ turn, item });
      } else {
        const item: AgentTrajectoryCompactionItem = {
          ...baseItem(itemId, "compaction", "completed", event, selection),
        };
        itemDrafts.push({ turn, item });
      }

      evidenceIndex += 1;
    }
  }

  forEachToolCorrelationGroup(toolGroups, (group) => finalizeToolGroup(group, warnings));

  const items: AgentTrajectoryItem[] = [];
  let toolCount = 0;
  let failedToolCount = 0;
  for (const draft of itemDrafts) {
    if (!draft.item) {
      continue;
    }
    items.push(draft.item);
    if (draft.turn) {
      draft.turn.items.push(draft.item);
    }
    if (draft.item.kind === "tool") {
      toolCount += 1;
      if (draft.item.status === "failed") {
        failedToolCount += 1;
      }
    }
  }

  const trajectoryTurns: AgentTrajectoryTurn[] = [];
  for (const turn of turns) {
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
    } else {
      warnings.push({ ...turn.firstSource, kind: "open-turn", turnId: turn.warningTurnId });
    }

    trajectoryTurns.push({
      id: turn.id,
      status: turn.status,
      items: turn.items,
      ...(turn.turnIndex === undefined ? {} : { turnIndex: turn.turnIndex }),
      ...(startedAt === undefined ? {} : { startedAt }),
      ...(endedAt === undefined ? {} : { endedAt }),
      ...(durationMs === undefined ? {} : { durationMs }),
    });
  }

  return {
    turns: trajectoryTurns,
    items,
    warnings,
    stats: {
      turnCount: trajectoryTurns.length,
      itemCount: items.length,
      toolCount,
      failedToolCount,
      tokenUsage: totalTokenUsage,
    },
  };
};
