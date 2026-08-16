import { useCallback, useEffect, useState } from "react";
import type {
  AgentTrajectoryFilterKind,
  AgentTrajectoryFilterStatus,
  AgentTrajectoryTimeRange,
} from "../lib/agent-session/trajectory-presentation";
import type { AgentSessionModel } from "../lib/agent-session/types";

export interface TrajectoryFilters {
  readonly query: string;
  readonly kind: AgentTrajectoryFilterKind;
  readonly status: AgentTrajectoryFilterStatus;
  readonly timeRange: AgentTrajectoryTimeRange | null;
  readonly setQuery: (query: string) => void;
  readonly setKind: (kind: AgentTrajectoryFilterKind) => void;
  readonly setStatus: (status: AgentTrajectoryFilterStatus) => void;
  readonly setTimeRange: (range: AgentTrajectoryTimeRange | null) => void;
  readonly clear: () => void;
}

/**
 * Owns the trajectory filter state above the view so switching output tabs
 * does not discard it; a new session model still resets every filter.
 */
export const useTrajectoryFilters = (model: AgentSessionModel | null): TrajectoryFilters => {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<AgentTrajectoryFilterKind>("all");
  const [status, setStatus] = useState<AgentTrajectoryFilterStatus>("all");
  const [timeRange, setTimeRange] = useState<AgentTrajectoryTimeRange | null>(null);

  const clear = useCallback(() => {
    setQuery("");
    setKind("all");
    setStatus("all");
    setTimeRange(null);
  }, []);

  useEffect(() => {
    clear();
  }, [clear, model]);

  return { query, kind, status, timeRange, setQuery, setKind, setStatus, setTimeRange, clear };
};
