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
}

export type AgentParseWarningKind = "invalid-json" | "projection-failed";

export interface AgentParseWarning {
  kind: AgentParseWarningKind;
  recordId: string;
  lineNumber: number;
}

export interface AgentTrajectoryTokenUsage {
  readonly inputTokens?: number;
  readonly cacheCreationInputTokens?: number;
  readonly cacheReadInputTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningOutputTokens?: number;
}

export type AgentTrajectoryStatus = "running" | "completed" | "failed" | "aborted";

interface AgentSessionEvidenceBase {
  turnId?: string;
}

export interface AgentTurnLifecycleEvidence extends AgentSessionEvidenceBase {
  kind: "turn-lifecycle";
  phase: "start" | "complete" | "failed" | "aborted";
  // Boundary moment stated by the adapter when it differs from the carrying
  // event's own timestamp, e.g. a turn closed retroactively by a later record.
  timestamp?: number;
  // Authoritative turn duration reported by the log itself.
  durationMs?: number;
}

export interface AgentModelOutputEvidence extends AgentSessionEvidenceBase {
  kind: "model-output";
  role: "user" | "assistant" | "reasoning" | "system";
  conversationItem?: AgentConversationItem;
}

export interface AgentToolCallEvidence extends AgentSessionEvidenceBase {
  kind: "tool-lifecycle";
  phase: "call";
  toolName: string;
  callId?: string;
  conversationItem?: AgentConversationItem;
}

export interface AgentToolResultEvidence extends AgentSessionEvidenceBase {
  kind: "tool-lifecycle";
  phase: "result";
  status?: "completed" | "failed";
  callId?: string;
  durationMs?: number;
  conversationItem?: AgentConversationItem;
}

export interface AgentToolCompletionEvidence extends AgentSessionEvidenceBase {
  kind: "tool-lifecycle";
  phase: "completion";
  status?: "completed" | "failed";
  callId?: string;
  durationMs?: number;
}

export type AgentToolLifecycleEvidence =
  | AgentToolCallEvidence
  | AgentToolResultEvidence
  | AgentToolCompletionEvidence;

interface AgentTokenUsageEvidenceBase extends AgentSessionEvidenceBase {
  kind: "token-usage";
}

export type AgentTokenUsageEvidence =
  | (AgentTokenUsageEvidenceBase & {
      usage: AgentTrajectoryTokenUsage;
      cumulativeUsage?: AgentTrajectoryTokenUsage;
    })
  | (AgentTokenUsageEvidenceBase & {
      usage?: never;
      cumulativeUsage: AgentTrajectoryTokenUsage;
    });

export interface AgentSubagentActivityEvidence extends AgentSessionEvidenceBase {
  kind: "subagent-activity";
  status: AgentTrajectoryStatus;
}

export interface AgentCompactionEvidence extends AgentSessionEvidenceBase {
  kind: "compaction";
}

export type AgentSessionEvidence =
  | AgentTurnLifecycleEvidence
  | AgentModelOutputEvidence
  | AgentToolLifecycleEvidence
  | AgentTokenUsageEvidence
  | AgentSubagentActivityEvidence
  | AgentCompactionEvidence;

export type AgentContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_use"; text: string }
  | { type: "tool_result"; text: string };

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
  timestampLabel?: string;
  sessionEvidence?: readonly AgentSessionEvidence[];
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
  parseWarningCount: number;
}

export type AgentCanonicalSelection =
  | { readonly kind: "record"; readonly recordId: string }
  | { readonly kind: "event"; readonly id: string; readonly recordId: string }
  | { readonly kind: "conversation"; readonly id: string; readonly recordId: string };

export type AgentDetailSelection =
  | AgentCanonicalSelection
  | { readonly kind: "trajectory"; readonly id: string; readonly recordId: string };
