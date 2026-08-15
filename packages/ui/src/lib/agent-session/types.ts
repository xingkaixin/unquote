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

export interface AgentTrajectoryTokenUsage {
  inputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
}

export interface AgentTrajectoryTokenUsageSnapshot {
  readonly inputTokens?: number;
  readonly cacheCreationInputTokens?: number;
  readonly cacheReadInputTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningOutputTokens?: number;
}

export type AgentTrajectoryStatus = "running" | "completed" | "failed" | "aborted";

interface AgentTrajectoryEvidenceBase {
  turnId?: string;
}

export interface AgentTurnLifecycleEvidence extends AgentTrajectoryEvidenceBase {
  kind: "turn-lifecycle";
  phase: "start" | "complete" | "failed" | "aborted";
}

export interface AgentModelOutputEvidence extends AgentTrajectoryEvidenceBase {
  kind: "model-output";
  role: "user" | "assistant" | "reasoning" | "system";
  conversationItemId?: string;
}

export interface AgentToolCallEvidence extends AgentTrajectoryEvidenceBase {
  kind: "tool-lifecycle";
  phase: "call";
  toolName: string;
  callId?: string;
  conversationItemId?: string;
}

export interface AgentToolResultEvidence extends AgentTrajectoryEvidenceBase {
  kind: "tool-lifecycle";
  phase: "result";
  status?: "completed" | "failed";
  callId?: string;
  durationMs?: number;
  conversationItemId?: string;
}

export interface AgentToolCompletionEvidence extends AgentTrajectoryEvidenceBase {
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

interface AgentTokenUsageEvidenceBase extends AgentTrajectoryEvidenceBase {
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

export interface AgentSubagentActivityEvidence extends AgentTrajectoryEvidenceBase {
  kind: "subagent-activity";
  status: AgentTrajectoryStatus;
}

export interface AgentCompactionEvidence extends AgentTrajectoryEvidenceBase {
  kind: "compaction";
}

export type AgentTrajectoryEvidence =
  | AgentTurnLifecycleEvidence
  | AgentModelOutputEvidence
  | AgentToolLifecycleEvidence
  | AgentTokenUsageEvidence
  | AgentSubagentActivityEvidence
  | AgentCompactionEvidence;

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
  trajectoryEvidence?: readonly AgentTrajectoryEvidence[];
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

export type AgentCanonicalSelection =
  | { readonly kind: "record"; readonly recordId: string }
  | { readonly kind: "event"; readonly id: string; readonly recordId: string }
  | { readonly kind: "conversation"; readonly id: string; readonly recordId: string };

export type AgentDetailSelection =
  | AgentCanonicalSelection
  | { readonly kind: "trajectory"; readonly id: string; readonly recordId: string };

export type AgentTrajectoryItemKind =
  | "user"
  | "system"
  | "assistant"
  | "reasoning"
  | "tool"
  | "subagent"
  | "compaction";

export interface AgentTrajectoryStep {
  readonly index: number;
  readonly source: "derived";
}

export interface AgentTrajectoryItemBase<
  TKind extends AgentTrajectoryItemKind = AgentTrajectoryItemKind,
  TStatus extends AgentTrajectoryStatus = AgentTrajectoryStatus,
> {
  readonly id: string;
  readonly kind: TKind;
  readonly status: TStatus;
  readonly recordId: string;
  readonly lineNumber: number;
  readonly selection: AgentCanonicalSelection;
  readonly timestamp?: number;
  readonly turnIndex?: number;
}

export interface AgentTrajectoryToolItem extends AgentTrajectoryItemBase<
  "tool",
  "running" | "completed" | "failed"
> {
  readonly toolName?: string;
  readonly callId?: string;
  readonly callSelection?: AgentCanonicalSelection;
  readonly resultSelection?: AgentCanonicalSelection;
  readonly completionSelection?: AgentCanonicalSelection;
  readonly startedAt?: number;
  readonly endedAt?: number;
  readonly durationMs?: number;
}

export type AgentTrajectoryUserItem = AgentTrajectoryItemBase<"user", "completed">;

export type AgentTrajectorySystemItem = AgentTrajectoryItemBase<"system", "completed">;

export type AgentTrajectoryAssistantReasoningItem = AgentTrajectoryItemBase<
  "assistant" | "reasoning",
  "completed"
> & {
  readonly step?: AgentTrajectoryStep;
  readonly tokenUsage?: AgentTrajectoryTokenUsageSnapshot;
};

export type AgentTrajectoryModelOutputItem =
  | AgentTrajectoryUserItem
  | AgentTrajectorySystemItem
  | AgentTrajectoryAssistantReasoningItem;

export type AgentTrajectorySubagentItem = AgentTrajectoryItemBase<
  "subagent",
  AgentTrajectoryStatus
>;

export type AgentTrajectoryCompactionItem = AgentTrajectoryItemBase<"compaction", "completed">;

export type AgentTrajectoryItem =
  | AgentTrajectoryToolItem
  | AgentTrajectoryModelOutputItem
  | AgentTrajectorySubagentItem
  | AgentTrajectoryCompactionItem;

export interface AgentTrajectoryTurn {
  readonly id: string;
  readonly status: AgentTrajectoryStatus;
  readonly items: readonly AgentTrajectoryItem[];
  readonly turnIndex?: number;
  readonly startedAt?: number;
  readonly endedAt?: number;
  readonly durationMs?: number;
}

interface AgentTrajectoryWarningBase {
  readonly recordId: string;
  readonly lineNumber: number;
  readonly selection: AgentCanonicalSelection;
  readonly turnIndex?: number;
}

export type AgentTrajectoryWarning =
  | (AgentTrajectoryWarningBase & {
      readonly kind: "missing-timestamp";
      readonly subject: "tool";
      readonly endpoint: "call" | "result" | "completion";
      readonly callId?: string;
    })
  | (AgentTrajectoryWarningBase & {
      readonly kind: "missing-timestamp";
      readonly subject: "turn";
      readonly endpoint: "start" | "terminal";
      readonly turnId: string;
    })
  | (AgentTrajectoryWarningBase & {
      readonly kind: "missing-turn-start";
      readonly turnId: string;
    })
  | (AgentTrajectoryWarningBase & {
      readonly kind: "reversed-timestamp";
      readonly subject: "tool";
      readonly callId?: string;
    })
  | (AgentTrajectoryWarningBase & {
      readonly kind: "reversed-timestamp";
      readonly subject: "turn";
      readonly turnId: string;
    })
  | (AgentTrajectoryWarningBase & {
      readonly kind: "unpaired-tool-call";
      readonly callId?: string;
    })
  | (AgentTrajectoryWarningBase & {
      readonly kind: "unpaired-tool-result";
      readonly callId?: string;
    })
  | (AgentTrajectoryWarningBase & {
      readonly kind: "unpaired-tool-completion";
      readonly callId?: string;
    })
  | (AgentTrajectoryWarningBase & {
      readonly kind: "duplicate-tool-call-id";
      readonly callId: string;
    })
  | (AgentTrajectoryWarningBase & {
      readonly kind: "duplicate-tool-result-id";
      readonly callId: string;
    })
  | (AgentTrajectoryWarningBase & {
      readonly kind: "duplicate-tool-completion-id";
      readonly callId: string;
    })
  | (AgentTrajectoryWarningBase & {
      readonly kind: "open-turn";
      readonly turnId: string;
    })
  | (AgentTrajectoryWarningBase & {
      readonly kind: "unattached-token-usage";
    });

export interface AgentTrajectoryStats {
  readonly turnCount: number;
  readonly itemCount: number;
  readonly toolCount: number;
  readonly failedToolCount: number;
  readonly tokenUsage: AgentTrajectoryTokenUsageSnapshot;
}

export interface AgentTrajectoryModel {
  readonly turns: readonly AgentTrajectoryTurn[];
  readonly items: readonly AgentTrajectoryItem[];
  readonly warnings: readonly AgentTrajectoryWarning[];
  readonly stats: AgentTrajectoryStats;
}

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
  readonly trajectory: AgentTrajectoryModel;
  resolveDetail(selection: AgentDetailSelection | null): AgentSessionDetail | null;
  selectEvent(eventId: string): AgentDetailSelection | null;
  selectConversation(itemId: string): AgentDetailSelection | null;
  selectTrajectory(itemId: string): AgentDetailSelection | null;
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
