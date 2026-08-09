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

export type AgentContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | {
      type: "tool_use";
      text: string;
      toolName: string;
      toolCallId?: string;
    }
  | {
      type: "tool_result";
      text: string;
      toolCallId?: string;
      status: "completed" | "failed";
    };

export interface AgentTimelineEvent {
  id: string;
  recordId: string;
  lineNumber: number;
  category: AgentEventCategory;
  kind: string;
  label: string;
  preview: string;
  conversationItems: AgentConversationItem[];
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
  role: AgentConversationRole;
  turnIndex?: number;
  block?: AgentContentBlock;
}

export interface AgentSession {
  fileType: "Codex" | "Claude Code";
  fileName?: string;
  meta: AgentSessionMeta;
  events: AgentTimelineEvent[];
  parseWarnings: AgentParseWarning[];
}

export type AgentDetailSelection =
  | { kind: "record"; recordId: string }
  | { kind: "event"; id: string; recordId: string }
  | { kind: "conversation"; id: string; recordId: string };

export interface AgentConversationEntry {
  item: AgentConversationItem;
  event: AgentTimelineEvent;
}

export interface AgentSessionDetail {
  event: AgentTimelineEvent;
  conversationItem?: AgentConversationItem;
  recordId: string;
}

export type AgentToolStatus = "pending" | "completed" | "failed";

export type AgentSessionIntegrityIssue =
  | { kind: "duplicate-event-id"; id: string }
  | { kind: "duplicate-record-id"; recordId: string }
  | { kind: "duplicate-conversation-id"; id: string };

export interface AgentSessionModel {
  events: readonly AgentTimelineEvent[];
  conversation: readonly AgentConversationEntry[];
  integrityIssues: readonly AgentSessionIntegrityIssue[];
  resolveDetail(selection: AgentDetailSelection | null): AgentSessionDetail | null;
  selectEvent(eventId: string): AgentDetailSelection | null;
  selectConversation(itemId: string): AgentDetailSelection | null;
  resolveToolStatus(item: AgentConversationItem): AgentToolStatus;
  resolveToolName(item: AgentConversationItem): string | undefined;
}

export interface ParsedAgentLine {
  recordId: string;
  lineNumber: number;
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
