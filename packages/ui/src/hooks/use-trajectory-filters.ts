import { useCallback, useEffect, useState } from "react";
import type { AgentSessionModel } from "../lib/agent-session/types";
import type { TrajectoryFilters } from "../lib/trajectory-filters";

/**
 * Owns the trajectory filter state above the view so switching output tabs
 * does not discard it; a new session model still resets every filter.
 */
export const useTrajectoryFilters = (model: AgentSessionModel | null): TrajectoryFilters => {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<TrajectoryFilters["kind"]>("all");
  const [status, setStatus] = useState<TrajectoryFilters["status"]>("all");
  const [timeRange, setTimeRange] = useState<TrajectoryFilters["timeRange"]>(null);

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
