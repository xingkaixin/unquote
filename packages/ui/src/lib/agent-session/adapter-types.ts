import type { AgentParseWarning, AgentSession } from "./session-types";

export interface ParsedAgentLine {
  recordId: string;
  lineNumber: number;
  data: unknown;
}

export interface AgentDetectionSample {
  type: string | undefined;
  hasObjectPayload: boolean;
  hasUuid: boolean;
  hasObjectMessage: boolean;
  hasSessionId: boolean;
}

export interface AgentAdapterBuilder {
  push(line: ParsedAgentLine): void;
  finish(parseWarnings: AgentParseWarning[]): AgentSession;
}

export interface AgentSessionAdapter {
  detect(samples: AgentDetectionSample[]): number;
  createBuilder(fileName?: string): AgentAdapterBuilder;
}
