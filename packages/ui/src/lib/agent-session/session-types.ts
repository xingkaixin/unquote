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

// Totals the agent wrote into its own log; never derived or priced by Unquote.
export interface AgentSessionReportedTotals {
  costUSD?: number;
  hasUnknownModelCost?: true;
  apiDurationMs?: number;
  toolDurationMs?: number;
  linesAdded?: number;
  linesRemoved?: number;
}

export interface AgentSessionMeta {
  sessionId?: string;
  title?: string;
  model?: string;
  cwd?: string;
  version?: string;
  reportedTotals?: AgentSessionReportedTotals;
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
  // Target turn when a later event closes an earlier turn without an id.
  turnIndex?: number;
  // Boundary moment stated by the adapter when it differs from the carrying
  // event's own timestamp, e.g. a turn closed retroactively by a later record.
  timestamp?: number;
  // Authoritative turn duration reported by the log itself.
  durationMs?: number;
}

export interface AgentModelOutputEvidence extends AgentSessionEvidenceBase {
  kind: "model-output";
  role: "user" | "assistant" | "reasoning" | "system";
  conversationItemId?: string;
}

export interface AgentToolCallEvidence extends AgentSessionEvidenceBase {
  kind: "tool-lifecycle";
  phase: "call";
  toolName: string;
  callId?: string;
  conversationItemId?: string;
}

export interface AgentToolResultEvidence extends AgentSessionEvidenceBase {
  kind: "tool-lifecycle";
  phase: "result";
  status?: "completed" | "failed";
  callId?: string;
  durationMs?: number;
  conversationItemId?: string;
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

// A tool run the log reports in one record without a call id to pair it with,
// e.g. a command started inside a Codex code-mode script.
export interface AgentToolExecutionEvidence extends AgentSessionEvidenceBase {
  kind: "tool-execution";
  toolName: string;
  status: "completed" | "failed";
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
}

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

// A model API request the agent reported as failed, with the retry it scheduled.
export interface AgentApiErrorEvidence extends AgentSessionEvidenceBase {
  kind: "api-error";
  retryAttempt?: number;
  maxRetries?: number;
  retryInMs?: number;
}

export type AgentSessionEvidence =
  | AgentTurnLifecycleEvidence
  | AgentModelOutputEvidence
  | AgentToolLifecycleEvidence
  | AgentToolExecutionEvidence
  | AgentTokenUsageEvidence
  | AgentSubagentActivityEvidence
  | AgentCompactionEvidence
  | AgentApiErrorEvidence;

export type AgentContentBlock = (
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_use"; text: string }
  | { type: "tool_result"; text: string }
) & {
  // JSON paths of the block's content in its source Record. `text` is bounded for
  // display, so exports read the full values from these paths instead.
  sourcePaths?: readonly string[];
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
  timestampLabel?: string;
  sessionEvidence?: readonly AgentSessionEvidence[];
}

export interface AgentConversationItem {
  id: string;
  role: AgentConversationRole;
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
