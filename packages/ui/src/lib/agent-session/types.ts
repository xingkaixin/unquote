export type AgentEventCategory =
  | "user"
  | "assistant"
  | "thinking"
  | "tool"
  | "system"
  | "meta"
  | "unknown";

export type AgentConversationRole =
  | "user"
  | "assistant"
  | "system"
  | "thinking"
  | "tool_call"
  | "tool_result";

export interface AgentSessionMeta {
  sessionId?: string;
  model?: string;
  cwd?: string;
  version?: string;
  eventCount: number;
  turnCount: number;
}

export interface AgentParseWarning {
  lineNumber: number;
  message: string;
}

export interface AgentTokenUsage {
  inputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  outputTokens: number;
}

export interface AgentContentBlock {
  type: "text" | "thinking" | "tool_use";
  text: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolCallId?: string;
  status?: "pending" | "completed" | "failed";
}

export interface AgentTimelineEvent {
  id: string;
  recordId: string;
  lineNumber: number;
  rawLine: string;
  category: AgentEventCategory;
  kind: string;
  label: string;
  preview: string;
  conversationItemIds: string[];
  timestamp?: number;
  turnIndex?: number;
  requestId?: string;
  model?: string;
  usage?: AgentTokenUsage;
  uuid?: string;
  sessionId?: string;
  cwd?: string;
  timestampLabel?: string;
  role?: string;
  stopReason?: string;
}

export interface AgentConversationItem {
  id: string;
  eventId: string;
  recordId: string;
  lineNumber: number;
  role: AgentConversationRole;
  turnIndex?: number;
  block?: AgentContentBlock;
}

export interface AgentSession {
  fileType: "Codex" | "Claude Code";
  fileName?: string;
  meta: AgentSessionMeta;
  events: AgentTimelineEvent[];
  conversationItems: AgentConversationItem[];
  parseWarnings: AgentParseWarning[];
}

export interface ParsedAgentLine {
  lineNumber: number;
  raw: string;
  data: unknown;
}

export interface AgentAdapterBuilder {
  push(line: ParsedAgentLine): void;
  finish(parseWarnings: AgentParseWarning[]): AgentSession;
}

export interface AgentSessionAdapter {
  // Same value the builder's finish() writes into session.fileType.
  fileType: AgentSession["fileType"];
  detect(samples: ParsedAgentLine[]): number;
  createBuilder(fileName?: string): AgentAdapterBuilder;
}
