import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentSession } from "../lib/agent-session";

export type OutputView = "agent" | "json";

const buildAgentSessionKey = (session: AgentSession | null) => {
  if (!session) {
    return null;
  }

  const conversationCount = session.events.reduce(
    (count, event) => count + event.conversationItems.length,
    0,
  );
  return [
    session.fileType,
    session.fileName ?? "",
    session.meta.sessionId ?? "",
    session.events.length,
    conversationCount,
  ].join(":");
};

export const useOutputView = (agentSession: AgentSession | null) => {
  const [outputView, setOutputView] = useState<OutputView>("json");
  const sessionKeyRef = useRef<string | null>(null);
  const sessionKey = useMemo(() => buildAgentSessionKey(agentSession), [agentSession]);

  useEffect(() => {
    if (sessionKeyRef.current === sessionKey) {
      return;
    }

    sessionKeyRef.current = sessionKey;
    setOutputView(agentSession ? "agent" : "json");
  }, [agentSession, sessionKey]);

  return { outputView, setOutputView };
};
