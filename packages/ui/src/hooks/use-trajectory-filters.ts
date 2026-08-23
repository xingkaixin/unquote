import { useCallback } from "react";
import type { SourceRevision } from "../lib/source-revision";
import type { TrajectoryFilters } from "../lib/trajectory-filters";
import { useSourceRevisionState } from "./use-source-revision-state";

type TrajectoryFilterState = Pick<TrajectoryFilters, "query" | "kind" | "status" | "timeRange">;

const createInitialTrajectoryFilters = (): TrajectoryFilterState => ({
  query: "",
  kind: "all",
  status: "all",
  timeRange: null,
});

export const useTrajectoryFilters = (sourceRevision: SourceRevision): TrajectoryFilters => {
  const [state, updateState] = useSourceRevisionState(
    sourceRevision,
    createInitialTrajectoryFilters,
  );
  const setQuery = useCallback(
    (query: string) =>
      updateState((current) => (current.query === query ? current : { ...current, query })),
    [updateState],
  );
  const setKind = useCallback(
    (kind: TrajectoryFilters["kind"]) =>
      updateState((current) => (current.kind === kind ? current : { ...current, kind })),
    [updateState],
  );
  const setStatus = useCallback(
    (status: TrajectoryFilters["status"]) =>
      updateState((current) => (current.status === status ? current : { ...current, status })),
    [updateState],
  );
  const setTimeRange = useCallback(
    (timeRange: TrajectoryFilters["timeRange"]) =>
      updateState((current) =>
        current.timeRange === timeRange ? current : { ...current, timeRange },
      ),
    [updateState],
  );

  const clear = useCallback(() => {
    updateState((current) =>
      current.query === "" &&
      current.kind === "all" &&
      current.status === "all" &&
      current.timeRange === null
        ? current
        : createInitialTrajectoryFilters(),
    );
  }, [updateState]);

  return { ...state, setQuery, setKind, setStatus, setTimeRange, clear };
};
