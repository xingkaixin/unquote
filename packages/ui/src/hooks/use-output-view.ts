import { useCallback, useEffect } from "react";
import type { AgentSession } from "../lib/agent-session";
import type { SourceRevision } from "../lib/source-revision";
import { useSourceRevisionState } from "./use-source-revision-state";

export type OutputView = "agent" | "trajectory" | "json";

export const isOutputView = (value: string): value is OutputView =>
  value === "agent" || value === "trajectory" || value === "json";

interface OutputViewState {
  selected: OutputView;
  hasDefaultedAgent: boolean;
}

const createInitialOutputViewState = (): OutputViewState => ({
  selected: "json",
  hasDefaultedAgent: false,
});

export const useOutputView = (
  sourceRevision: SourceRevision,
  agentSession: AgentSession | null,
) => {
  const [state, updateState] = useSourceRevisionState(sourceRevision, createInitialOutputViewState);
  const hasAgentSession = agentSession !== null;
  const setOutputView = useCallback(
    (view: OutputView) => {
      updateState((current) =>
        current.selected === view ? current : { ...current, selected: view },
      );
    },
    [updateState],
  );

  useEffect(() => {
    if (!hasAgentSession || state.hasDefaultedAgent) {
      return;
    }

    updateState((current) =>
      current.hasDefaultedAgent ? current : { selected: "agent", hasDefaultedAgent: true },
    );
  }, [hasAgentSession, state.hasDefaultedAgent, updateState]);

  return { outputView: hasAgentSession ? state.selected : "json", setOutputView };
};
