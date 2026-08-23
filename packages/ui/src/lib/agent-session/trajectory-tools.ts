import type {
  AgentCanonicalSelection,
  AgentToolCallEvidence,
  AgentToolCompletionEvidence,
  AgentToolResultEvidence,
  AgentTimelineEvent,
} from "./session-types";
import type {
  AgentTrajectoryItem,
  AgentTrajectoryToolItem,
  AgentTrajectoryWarning,
} from "./trajectory-types";
import {
  resolveToolLifecycleStatus,
  type AgentToolLifecycleIndex,
  type AgentToolLifecycleOccurrence,
  type AgentToolLifecycleResolution,
} from "./tool-lifecycle";
import type { ToolCorrelationGroup, ToolCorrelationResolution } from "./tool-correlation";
import { finiteTrajectoryNumber } from "./trajectory-time";
import type { TrajectoryTurnRef, TrajectoryWarningSource } from "./trajectory-turns";
import {
  nonEmptyTrajectoryValue,
  nonNegativeTrajectoryDuration,
  trajectoryItemBase,
} from "./trajectory-values";

type ToolLifecycleEvidence = Extract<
  AgentToolCallEvidence | AgentToolResultEvidence | AgentToolCompletionEvidence,
  { kind: "tool-lifecycle" }
>;

export interface TrajectoryItemDraft {
  turn: TrajectoryTurnRef | null;
  item: AgentTrajectoryItem | null;
}

export interface TrajectoryEvidenceContext {
  event: AgentTimelineEvent;
  itemId: string;
  selection: AgentCanonicalSelection;
  source: TrajectoryWarningSource;
  turn: TrajectoryTurnRef | null;
}

interface ToolProjectionContext {
  itemId: string;
  selection: AgentCanonicalSelection;
  source: TrajectoryWarningSource;
  draft: TrajectoryItemDraft;
}

interface ToolOccurrenceBase<TEvidence extends ToolLifecycleEvidence> {
  evidence: TEvidence;
  itemId: string;
  selection: AgentCanonicalSelection;
  source: TrajectoryWarningSource;
  timestamp: number | undefined;
  draft: TrajectoryItemDraft;
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
type ToolResolution = ToolCorrelationResolution<
  ToolCallOccurrence,
  ToolResultOccurrence,
  ToolCompletionOccurrence
>;

const toolOccurrenceFor = <TEvidence extends ToolLifecycleEvidence>(
  evidence: TEvidence,
  itemId: string,
  selection: AgentCanonicalSelection,
  source: TrajectoryWarningSource,
  event: AgentTimelineEvent,
  draft: TrajectoryItemDraft,
): ToolOccurrenceBase<TEvidence> => ({
  evidence,
  itemId,
  selection,
  source,
  timestamp: finiteTrajectoryNumber(event.timestamp),
  draft,
  event,
});

const addUnpairedCallWarning = (
  warnings: AgentTrajectoryWarning[],
  occurrence: ToolCallOccurrence,
) => {
  const callId = nonEmptyTrajectoryValue(occurrence.evidence.callId);
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
  const callId = nonEmptyTrajectoryValue(occurrence.evidence.callId);
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
  const callId = nonEmptyTrajectoryValue(occurrence.evidence.callId);
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
  const callId = nonEmptyTrajectoryValue(
    call?.evidence.callId ?? result?.evidence.callId ?? completion?.evidence.callId,
  );
  const endedAt = terminal?.timestamp;
  const item: AgentTrajectoryToolItem = {
    ...trajectoryItemBase(
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
    nonNegativeTrajectoryDuration(completion?.evidence.durationMs) ??
    nonNegativeTrajectoryDuration(result?.evidence.durationMs);
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
    derivedDuration = nonNegativeTrajectoryDuration(terminal.timestamp - call.timestamp);
  }

  const duration = explicitDuration ?? derivedDuration;
  return duration === undefined ? item : { ...item, durationMs: duration };
};

const addDuplicateWarning = (
  warnings: AgentTrajectoryWarning[],
  occurrence: ToolCallOccurrence | ToolResultOccurrence | ToolCompletionOccurrence,
) => {
  const callId = nonEmptyTrajectoryValue(occurrence.evidence.callId);
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

const finalizeToolGroup = (resolution: ToolResolution, warnings: AgentTrajectoryWarning[]) => {
  if (resolution.kind === "repeated") {
    addDuplicateWarnings(resolution, warnings);
    for (const call of resolution.calls) {
      call.draft.item = toolItemFor(call, undefined, undefined, warnings);
      addUnpairedCallWarning(warnings, call);
    }
    for (const result of resolution.results) {
      result.draft.item = toolItemFor(undefined, result, undefined, warnings);
      addUnpairedResultWarning(warnings, result);
    }
    for (const completion of resolution.completions) {
      completion.draft.item = toolItemFor(undefined, undefined, completion, warnings);
      addUnpairedCompletionWarning(warnings, completion);
    }
    return;
  }

  const { call, result, completion } = resolution;
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

const appendUngroupedTool = (
  evidence: ToolLifecycleEvidence,
  context: TrajectoryEvidenceContext,
  draft: TrajectoryItemDraft,
  warnings: AgentTrajectoryWarning[],
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
    draft.item = toolItemFor(occurrence, undefined, undefined, warnings);
    addUnpairedCallWarning(warnings, occurrence);
  } else if (evidence.phase === "result") {
    const occurrence = toolOccurrenceFor(
      evidence,
      context.itemId,
      context.selection,
      context.source,
      context.event,
      draft,
    );
    draft.item = toolItemFor(undefined, occurrence, undefined, warnings);
    addUnpairedResultWarning(warnings, occurrence);
  } else {
    const occurrence = toolOccurrenceFor(
      evidence,
      context.itemId,
      context.selection,
      context.source,
      context.event,
      draft,
    );
    draft.item = toolItemFor(undefined, undefined, occurrence, warnings);
    addUnpairedCompletionWarning(warnings, occurrence);
  }
};

export const createTrajectoryToolProjector = (
  toolLifecycle: AgentToolLifecycleIndex,
  warnings: AgentTrajectoryWarning[],
) => {
  const projectionByEvidence = new Map<ToolLifecycleEvidence, ToolProjectionContext>();

  const trajectoryOccurrenceFor = <TEvidence extends ToolLifecycleEvidence>(
    occurrence: AgentToolLifecycleOccurrence<TEvidence>,
  ) => {
    const context = projectionByEvidence.get(occurrence.evidence);
    if (!context) {
      throw new Error("Indexed tool evidence requires trajectory projection context");
    }
    return toolOccurrenceFor(
      occurrence.evidence,
      context.itemId,
      context.selection,
      context.source,
      occurrence.event,
      context.draft,
    );
  };

  const trajectoryResolutionFor = (resolution: AgentToolLifecycleResolution): ToolResolution =>
    resolution.kind === "repeated"
      ? {
          kind: "repeated",
          calls: resolution.calls.map(trajectoryOccurrenceFor),
          results: resolution.results.map(trajectoryOccurrenceFor),
          completions: resolution.completions.map(trajectoryOccurrenceFor),
        }
      : {
          kind: "unique",
          call: resolution.call ? trajectoryOccurrenceFor(resolution.call) : undefined,
          result: resolution.result ? trajectoryOccurrenceFor(resolution.result) : undefined,
          completion: resolution.completion
            ? trajectoryOccurrenceFor(resolution.completion)
            : undefined,
        };

  return {
    append(
      evidence: ToolLifecycleEvidence,
      context: TrajectoryEvidenceContext,
    ): TrajectoryItemDraft {
      const draft: TrajectoryItemDraft = { turn: context.turn, item: null };
      if (!toolLifecycle.groupedEvidence.has(evidence)) {
        appendUngroupedTool(evidence, context, draft, warnings);
      } else {
        projectionByEvidence.set(evidence, {
          itemId: context.itemId,
          selection: context.selection,
          source: context.source,
          draft,
        });
      }
      return draft;
    },
    finalize() {
      for (const resolution of toolLifecycle.groups) {
        finalizeToolGroup(trajectoryResolutionFor(resolution), warnings);
      }
    },
  };
};
