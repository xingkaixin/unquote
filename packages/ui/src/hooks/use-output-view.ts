import { useEffect, useRef, useState } from "react";
import type { AgentSession } from "../lib/agent-session";
import type { SourceRevision } from "../lib/source-revision";

export type OutputView = "agent" | "json";

interface OutputViewContext {
  sourceRevision: SourceRevision;
  hasDefaultedAgent: boolean;
}

export const useOutputView = (
  sourceRevision: SourceRevision,
  agentSession: AgentSession | null,
) => {
  const [outputView, setOutputView] = useState<OutputView>("json");
  const outputViewContextRef = useRef<OutputViewContext | null>(null);
  const hasAgentSession = agentSession !== null;

  useEffect(() => {
    let outputViewContext = outputViewContextRef.current;
    if (outputViewContext?.sourceRevision !== sourceRevision) {
      outputViewContext = { sourceRevision, hasDefaultedAgent: false };
      outputViewContextRef.current = outputViewContext;
    }

    if (!hasAgentSession) {
      setOutputView("json");
      return;
    }

    if (outputViewContext.hasDefaultedAgent) {
      return;
    }

    outputViewContext.hasDefaultedAgent = true;
    setOutputView("agent");
  }, [hasAgentSession, sourceRevision]);

  return { outputView, setOutputView };
};
