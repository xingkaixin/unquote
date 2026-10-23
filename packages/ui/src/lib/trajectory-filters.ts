import type {
  AgentTrajectoryFilterKind,
  AgentTrajectoryFilterStatus,
  AgentTrajectoryTimeRange,
} from "./agent-session/trajectory-presentation";

export interface TrajectoryFilters {
  readonly query: string;
  readonly kind: AgentTrajectoryFilterKind;
  readonly status: AgentTrajectoryFilterStatus;
  readonly toolName: string | null;
  readonly timeRange: AgentTrajectoryTimeRange | null;
  readonly setQuery: (query: string) => void;
  readonly setKind: (kind: AgentTrajectoryFilterKind) => void;
  readonly setStatus: (status: AgentTrajectoryFilterStatus) => void;
  readonly setToolName: (toolName: string | null) => void;
  readonly setTimeRange: (range: AgentTrajectoryTimeRange | null) => void;
  readonly clear: () => void;
}
