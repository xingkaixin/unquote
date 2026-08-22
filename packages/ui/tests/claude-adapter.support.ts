import { expect } from "vitest";
import {
  createAgentSessionModel,
  createAgentTrajectoryModel,
  type AgentSession,
} from "../src/lib/agent-session";
import type { AgentDetectionSample } from "../src/lib/agent-session/types";
import type { ParsedAgentLine } from "../src/lib/agent-session";

export const conversationItems = (session: AgentSession) =>
  createAgentSessionModel(session).conversation.map(({ item }) => item);

export const trajectoryTurnId = (source: "evidence" | "fallback-index", value: string | number) =>
  JSON.stringify([source, value]);

export const parsedLine = (data: unknown, lineNumber: number): ParsedAgentLine => ({
  data,
  lineNumber,
  recordId: `record-${lineNumber}`,
});

export const detectionSample = (
  overrides: Partial<AgentDetectionSample> = {},
): AgentDetectionSample => ({
  type: undefined,
  hasObjectPayload: false,
  hasUuid: false,
  hasObjectMessage: false,
  hasSessionId: false,
  ...overrides,
});

export const expectTrajectorySelectionsToResolve = (session: AgentSession) => {
  const trajectory = createAgentTrajectoryModel(session);
  const model = createAgentSessionModel(session);

  for (const item of trajectory.items) {
    expect(model.resolveDetail(item.selection)?.recordId).toBe(item.recordId);
    if (item.kind === "tool") {
      if (item.callSelection) {
        expect(model.resolveDetail(item.callSelection)?.recordId).toBe(item.callSelection.recordId);
      }
      if (item.resultSelection) {
        expect(model.resolveDetail(item.resultSelection)?.recordId).toBe(
          item.resultSelection.recordId,
        );
      }
    }
  }

  return trajectory;
};

export const transcriptSample = (index: number): AgentDetectionSample =>
  detectionSample({
    type: index % 2 === 0 ? "assistant" : "user",
    hasUuid: true,
    hasObjectMessage: true,
  });
