import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentSession } from "../lib/agent-session";
import type { SourceRevision } from "../lib/source-revision";

export type OutputView = "agent" | "trajectory" | "json";

export const isOutputView = (value: string): value is OutputView =>
  value === "agent" || value === "trajectory" || value === "json";

interface OutputViewContext {
  sourceRevision: SourceRevision;
  hasDefaultedAgent: boolean;
}

export const useOutputView = (
  sourceRevision: SourceRevision,
  agentSession: AgentSession | null,
) => {
  const [selectedOutputView, setSelectedOutputView] = useState<OutputView>("json");
  const outputViewContextRef = useRef<OutputViewContext | null>(null);
  const hasAgentSession = agentSession !== null;
  const setOutputView = useCallback((view: OutputView) => {
    setSelectedOutputView(view);
  }, []);

  useEffect(() => {
    let outputViewContext = outputViewContextRef.current;
    if (outputViewContext?.sourceRevision !== sourceRevision) {
      outputViewContext = { sourceRevision, hasDefaultedAgent: false };
      outputViewContextRef.current = outputViewContext;
    }

    if (!hasAgentSession) {
      return;
    }

    if (outputViewContext.hasDefaultedAgent) {
      return;
    }

    outputViewContext.hasDefaultedAgent = true;
    setSelectedOutputView("agent");
  }, [hasAgentSession, sourceRevision]);

  return { outputView: hasAgentSession ? selectedOutputView : "json", setOutputView };
};
