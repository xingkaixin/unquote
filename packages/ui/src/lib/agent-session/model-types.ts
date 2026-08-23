import type {
  AgentConversationItem,
  AgentDetailSelection,
  AgentTimelineEvent,
} from "./session-types";
import type { AgentTrajectoryModel } from "./trajectory-types";

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
