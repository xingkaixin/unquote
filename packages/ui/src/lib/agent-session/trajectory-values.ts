import type {
  AgentCanonicalSelection,
  AgentTrajectoryItem,
  AgentTrajectoryItemBase,
  AgentTrajectoryStatus,
  AgentTimelineEvent,
} from "./types";
import { finiteTrajectoryNumber } from "./trajectory-time";

export const finiteTrajectoryTurnIndex = (value: number | undefined) =>
  typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;

export const nonEmptyTrajectoryValue = (value: string | undefined) =>
  value && value.length > 0 ? value : undefined;

export const nonNegativeTrajectoryDuration = (value: number | undefined) => {
  const duration = finiteTrajectoryNumber(value);
  return duration !== undefined && duration >= 0 ? duration : undefined;
};

export const trajectoryItemBase = <
  TKind extends AgentTrajectoryItem["kind"],
  TStatus extends AgentTrajectoryStatus,
>(
  id: string,
  kind: TKind,
  status: TStatus,
  event: AgentTimelineEvent,
  selection: AgentCanonicalSelection,
): AgentTrajectoryItemBase<TKind, TStatus> => {
  const timestamp = finiteTrajectoryNumber(event.timestamp);
  const turnIndex = finiteTrajectoryTurnIndex(event.turnIndex);
  return {
    id,
    kind,
    status,
    recordId: event.recordId,
    lineNumber: event.lineNumber,
    selection,
    ...(timestamp === undefined ? {} : { timestamp }),
    ...(turnIndex === undefined ? {} : { turnIndex }),
  };
};
