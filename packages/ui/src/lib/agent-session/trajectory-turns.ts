import type {
  AgentCanonicalSelection,
  AgentSessionEvidence,
  AgentTrajectoryStatus,
  AgentTurnLifecycleEvidence,
  AgentTimelineEvent,
} from "./session-types";
import type {
  AgentTrajectoryStep,
  AgentTrajectoryTurn,
  AgentTrajectoryWarning,
} from "./trajectory-types";
import { finiteTrajectoryNumber } from "./trajectory-time";
import { toolCorrelationScope } from "./tool-correlation";
import { finiteTrajectoryTurnIndex, nonNegativeTrajectoryDuration } from "./trajectory-values";

export interface TrajectoryWarningSource {
  recordId: string;
  lineNumber: number;
  selection: AgentCanonicalSelection;
  turnIndex?: number;
}

export interface TrajectoryTurnRef {
  id: string;
  warningTurnId: string;
  status: AgentTrajectoryStatus;
  firstSource: TrajectoryWarningSource;
  hasTerminalLifecycle: boolean;
  pendingToolRecovery: boolean;
  nextStepIndex: number;
  turnIndex?: number;
  lifecycleStartSource?: TrajectoryWarningSource;
  lifecycleStartTimestamp?: number;
  terminalLifecycleSource?: TrajectoryWarningSource;
  terminalLifecycleTimestamp?: number;
  explicitDurationMs?: number;
  earliestNonTerminalTimestamp?: number;
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

const trajectoryTurnScopeFor = (
  event: AgentTimelineEvent,
  evidence: AgentSessionEvidence,
): TrajectoryTurnScope | null => {
  const turnIndex = finiteTrajectoryTurnIndex(event.turnIndex);
  const scope = toolCorrelationScope(evidence.turnId, turnIndex);
  if (scope.source !== "anonymous") {
    return scope;
  }
  return evidence.kind === "turn-lifecycle" ? syntheticTurnScope(event.id) : null;
};

export const trajectoryTurnIdFor = (event: AgentTimelineEvent, evidence: AgentSessionEvidence) => {
  const scope = trajectoryTurnScopeFor(event, evidence);
  return scope ? trajectoryTurnId(scope) : null;
};

export const trajectoryWarningSourceFor = (
  event: AgentTimelineEvent,
  selection: AgentCanonicalSelection,
): TrajectoryWarningSource => {
  const turnIndex = finiteTrajectoryTurnIndex(event.turnIndex);
  return {
    recordId: event.recordId,
    lineNumber: event.lineNumber,
    selection,
    ...(turnIndex === undefined ? {} : { turnIndex }),
  };
};

const terminalLifecycle = (evidence: AgentSessionEvidence) =>
  evidence.kind === "turn-lifecycle" && evidence.phase !== "start";

const observeEarliestNonTerminalTimestamp = (
  turn: TrajectoryTurnRef,
  event: AgentTimelineEvent,
) => {
  const timestamp = finiteTrajectoryNumber(event.timestamp);
  if (timestamp === undefined) {
    return;
  }
  const current = turn.earliestNonTerminalTimestamp;
  if (current === undefined || timestamp < current) {
    turn.earliestNonTerminalTimestamp = timestamp;
  }
};

const observeTurnLifecycle = (
  turn: TrajectoryTurnRef,
  evidence: AgentTurnLifecycleEvidence,
  event: AgentTimelineEvent,
  source: TrajectoryWarningSource,
) => {
  const timestamp =
    finiteTrajectoryNumber(evidence.timestamp) ?? finiteTrajectoryNumber(event.timestamp);
  if (evidence.phase === "start") {
    turn.lifecycleStartSource = source;
    if (timestamp !== undefined) {
      turn.lifecycleStartTimestamp = timestamp;
    }
    return;
  }

  turn.hasTerminalLifecycle = true;
  turn.terminalLifecycleSource = source;
  turn.status = evidence.phase === "complete" ? "completed" : evidence.phase;
  if (timestamp !== undefined) {
    turn.terminalLifecycleTimestamp = timestamp;
  }
  const explicitDuration = nonNegativeTrajectoryDuration(evidence.durationMs);
  if (explicitDuration !== undefined) {
    turn.explicitDurationMs = explicitDuration;
  }
};

const materializeTurn = (turn: TrajectoryTurnRef, warnings: AgentTrajectoryWarning[]) => {
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
        durationMs = nonNegativeTrajectoryDuration(endedAt - startedAt);
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

export const createTrajectoryTurnTracker = () => {
  const turns: TrajectoryTurnRef[] = [];
  const explicitTurnById = new Map<string, TrajectoryTurnRef>();
  const fallbackTurnByIndex = new Map<number, TrajectoryTurnRef>();
  const syntheticTurnByEventId = new Map<string, TrajectoryTurnRef>();

  const createTurn = (
    scope: TrajectoryTurnScope,
    turnIndex: number | undefined,
    source: TrajectoryWarningSource,
  ) => {
    const id = trajectoryTurnId(scope);
    const turn: TrajectoryTurnRef = {
      id,
      warningTurnId: scope.source === "evidence" ? scope.value : id,
      status: "running",
      firstSource: source,
      hasTerminalLifecycle: false,
      pendingToolRecovery: false,
      nextStepIndex: 1,
      ...(turnIndex === undefined ? {} : { turnIndex }),
    };
    turns.push(turn);
    return turn;
  };

  const resolveTurn = (
    event: AgentTimelineEvent,
    evidence: AgentSessionEvidence,
    source: TrajectoryWarningSource,
  ) => {
    const turnIndex = finiteTrajectoryTurnIndex(event.turnIndex);
    const scope = trajectoryTurnScopeFor(event, evidence);
    if (!scope) {
      return null;
    }
    if (scope.source === "evidence") {
      let turn = explicitTurnById.get(scope.value);
      if (!turn) {
        turn = createTurn(scope, turnIndex, source);
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
        turn = createTurn(scope, turnIndex, source);
        fallbackTurnByIndex.set(scope.value, turn);
      }
      return turn;
    }
    let turn = syntheticTurnByEventId.get(event.id);
    if (!turn) {
      turn = createTurn(syntheticTurnScope(event.id), undefined, source);
      syntheticTurnByEventId.set(event.id, turn);
    }
    return turn;
  };

  return {
    observe(
      event: AgentTimelineEvent,
      evidence: AgentSessionEvidence,
      source: TrajectoryWarningSource,
    ) {
      const turn = resolveTurn(event, evidence, source);
      if (!turn) {
        return null;
      }
      if (!terminalLifecycle(evidence)) {
        observeEarliestNonTerminalTimestamp(turn, event);
      }
      if (evidence.kind === "turn-lifecycle") {
        observeTurnLifecycle(turn, evidence, event, source);
      }
      return turn;
    },
    deriveStep(turn: TrajectoryTurnRef | null): AgentTrajectoryStep | undefined {
      if (!turn?.pendingToolRecovery) {
        return undefined;
      }
      const step = { index: turn.nextStepIndex, source: "derived" as const };
      turn.nextStepIndex += 1;
      turn.pendingToolRecovery = false;
      return step;
    },
    markToolRecovery(turn: TrajectoryTurnRef | null) {
      if (turn) {
        turn.pendingToolRecovery = true;
      }
    },
    materialize(warnings: AgentTrajectoryWarning[]) {
      return turns.map((turn) => materializeTurn(turn, warnings));
    },
  };
};
