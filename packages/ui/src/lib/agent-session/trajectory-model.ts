import type {
  AgentCanonicalSelection,
  AgentSession,
  AgentTrajectoryAssistantReasoningItem,
  AgentTrajectoryCompactionItem,
  AgentSessionEvidence,
  AgentTrajectoryItem,
  AgentTrajectoryModel,
  AgentTrajectorySystemItem,
  AgentTrajectorySubagentItem,
  AgentTrajectoryUserItem,
  AgentTrajectoryWarning,
  AgentTimelineEvent,
} from "./types";
import { canonicalizeAgentSession, type CanonicalAgentSession } from "./identity";
import { createAgentToolLifecycleIndex, type AgentToolLifecycleIndex } from "./tool-lifecycle";
import {
  mergeTokenUsage,
  mergeTotalTokenUsage,
  validTokenUsage,
  type AgentTrajectoryTokenUsageDraft,
} from "./trajectory-token-usage";
import {
  createTrajectoryTurnTracker,
  trajectoryWarningSourceFor as warningSourceFor,
  type TrajectoryTurnRef as TurnDraft,
} from "./trajectory-turns";
import {
  createTrajectoryToolProjector,
  type TrajectoryEvidenceContext as EvidenceContext,
  type TrajectoryItemDraft as ItemDraft,
} from "./trajectory-tools";
import { trajectoryItemBase } from "./trajectory-values";

type TrajectoryToolProjector = ReturnType<typeof createTrajectoryToolProjector>;
type TrajectoryTurnTracker = ReturnType<typeof createTrajectoryTurnTracker>;

type ModelOutputEvidence = Extract<AgentSessionEvidence, { kind: "model-output" }>;
type TokenUsageEvidence = Extract<AgentSessionEvidence, { kind: "token-usage" }>;

interface TrajectoryDraftState {
  itemDrafts: ItemDraft[];
  warnings: AgentTrajectoryWarning[];
  lastModelItemByTurn: Map<TurnDraft, ItemDraft>;
  totalTokenUsage: AgentTrajectoryTokenUsageDraft;
}

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

const itemIdFor = (event: AgentTimelineEvent, evidenceIndex: number) =>
  `${event.id}:evidence-${evidenceIndex}`;

const conversationItemIdFor = (evidence: AgentSessionEvidence) => {
  if (evidence.kind === "model-output") {
    return evidence.conversationItemId;
  }
  return evidence.kind === "tool-lifecycle" && evidence.phase !== "completion"
    ? evidence.conversationItemId
    : undefined;
};

const createTrajectoryDraftState = (): TrajectoryDraftState => ({
  itemDrafts: [],
  warnings: [],
  lastModelItemByTurn: new Map(),
  totalTokenUsage: {},
});

const appendModelOutput = (
  state: TrajectoryDraftState,
  turns: TrajectoryTurnTracker,
  evidence: ModelOutputEvidence,
  context: EvidenceContext,
) => {
  if (evidence.role === "user") {
    const item: AgentTrajectoryUserItem = {
      ...trajectoryItemBase(context.itemId, "user", "completed", context.event, context.selection),
    };
    state.itemDrafts.push({ turn: context.turn, item });
    return;
  }
  if (evidence.role === "system") {
    const item: AgentTrajectorySystemItem = {
      ...trajectoryItemBase(
        context.itemId,
        "system",
        "completed",
        context.event,
        context.selection,
      ),
    };
    state.itemDrafts.push({ turn: context.turn, item });
    return;
  }

  const step = turns.deriveStep(context.turn);
  const item: AgentTrajectoryAssistantReasoningItem = {
    ...trajectoryItemBase(
      context.itemId,
      evidence.role,
      "completed",
      context.event,
      context.selection,
    ),
    ...(step === undefined ? {} : { step }),
  };
  const draft = { turn: context.turn, item };
  state.itemDrafts.push(draft);
  if (context.turn) {
    state.lastModelItemByTurn.set(context.turn, draft);
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
  tools: TrajectoryToolProjector,
  turns: TrajectoryTurnTracker,
  evidence: AgentSessionEvidence,
  context: EvidenceContext,
) => {
  if (evidence.kind === "turn-lifecycle") {
    return;
  } else if (evidence.kind === "model-output") {
    appendModelOutput(state, turns, evidence, context);
  } else if (evidence.kind === "tool-lifecycle") {
    state.itemDrafts.push(tools.append(evidence, context));
    if (evidence.phase !== "call") {
      turns.markToolRecovery(context.turn);
    }
  } else if (evidence.kind === "token-usage") {
    observeTokenUsage(state, evidence, context);
  } else if (evidence.kind === "subagent-activity") {
    const item: AgentTrajectorySubagentItem = {
      ...trajectoryItemBase(
        context.itemId,
        "subagent",
        evidence.status,
        context.event,
        context.selection,
      ),
    };
    state.itemDrafts.push({ turn: context.turn, item });
  } else {
    const item: AgentTrajectoryCompactionItem = {
      ...trajectoryItemBase(
        context.itemId,
        "compaction",
        "completed",
        context.event,
        context.selection,
      ),
    };
    state.itemDrafts.push({ turn: context.turn, item });
  }
};

const collectEvidence = (
  state: TrajectoryDraftState,
  toolLifecycle: AgentToolLifecycleIndex,
  tools: TrajectoryToolProjector,
  turns: TrajectoryTurnTracker,
) => {
  for (const {
    evidence: evidenceList,
    canonicalEvent: { event, conversationItemIds },
  } of toolLifecycle.evidenceEvents) {
    let evidenceIndex = 0;
    for (const evidence of evidenceList) {
      const selection = selectionFor(event, conversationItemIdFor(evidence), conversationItemIds);
      const source = warningSourceFor(event, selection);
      const turn = turns.observe(event, evidence, source);
      appendEvidence(state, tools, turns, evidence, {
        event,
        itemId: itemIdFor(event, evidenceIndex),
        selection,
        source,
        turn,
      });
      evidenceIndex += 1;
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

export const createAgentTrajectoryModelFromCanonicalSession = (
  session: CanonicalAgentSession,
  toolLifecycle: AgentToolLifecycleIndex = createAgentToolLifecycleIndex(session),
): AgentTrajectoryModel => {
  const state = createTrajectoryDraftState();
  const turns = createTrajectoryTurnTracker();
  const tools = createTrajectoryToolProjector(toolLifecycle, state.warnings);
  collectEvidence(state, toolLifecycle, tools, turns);
  tools.finalize();
  return {
    turns: turns.materialize(state.warnings),
    items: materializeItems(state.itemDrafts),
    warnings: state.warnings,
    stats: { tokenUsage: state.totalTokenUsage },
  };
};

export const createAgentTrajectoryModel = (session: AgentSession): AgentTrajectoryModel =>
  createAgentTrajectoryModelFromCanonicalSession(canonicalizeAgentSession(session));
