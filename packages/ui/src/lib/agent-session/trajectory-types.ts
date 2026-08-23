import type {
  AgentCanonicalSelection,
  AgentTrajectoryStatus,
  AgentTrajectoryTokenUsage,
} from "./session-types";

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
  readonly turnId?: string;
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
  readonly tokenUsage?: AgentTrajectoryTokenUsage;
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
  readonly tokenUsage: AgentTrajectoryTokenUsage;
}

export interface AgentTrajectoryModel {
  readonly turns: readonly AgentTrajectoryTurn[];
  readonly items: readonly AgentTrajectoryItem[];
  readonly warnings: readonly AgentTrajectoryWarning[];
  readonly stats: AgentTrajectoryStats;
}
