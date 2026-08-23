import { createAgentSessionModel, type AgentSession } from "../src/lib/agent-session";
import type { AgentDetectionSample } from "../src/lib/agent-session/adapter-types";
import type { ParsedAgentLine } from "../src/lib/agent-session";

export const parsedLine = (data: unknown, lineNumber: number): ParsedAgentLine => ({
  data,
  lineNumber,
  recordId: `record-${lineNumber}`,
});

export const detectionSample = (
  type: string | undefined,
  hasObjectPayload = false,
): AgentDetectionSample => ({
  type,
  hasObjectPayload,
  hasUuid: false,
  hasObjectMessage: false,
  hasSessionId: false,
});

export const conversationItems = (session: AgentSession) =>
  createAgentSessionModel(session).conversation.map(({ item }) => item);

export const trajectoryTurnId = (turnId: string) => JSON.stringify(["evidence", turnId]);
