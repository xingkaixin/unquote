import type {
  AgentConversationItem,
  AgentEventCategory,
  AgentParseWarning,
  AgentSession,
  AgentTimelineEvent,
  ParsedAgentLine,
} from "./types";

export const parseTimestamp = (value: unknown): number | undefined => {
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? undefined : ms;
  }
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const getString = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

export const getBoolean = (record: Record<string, unknown>, key: string, defaultValue = false) => {
  const value = record[key];
  return typeof value === "boolean" ? value : defaultValue;
};

export const readTokenCount = (usage: Record<string, unknown>, key: string): number | undefined => {
  const value = usage[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

export const createBaseEvent = (
  line: ParsedAgentLine,
  category: AgentEventCategory,
  kind: string,
  label: string,
  preview: string,
  metadata: {
    timestamp: number | undefined;
    timestampLabel: string | undefined;
    turnIndex: number | undefined;
  },
): AgentTimelineEvent => ({
  id: `line-${line.lineNumber}`,
  recordId: line.recordId,
  lineNumber: line.lineNumber,
  category,
  kind,
  label,
  preview,
  conversationItems: [],
  ...(metadata.timestamp === undefined ? {} : { timestamp: metadata.timestamp }),
  ...(metadata.timestampLabel ? { timestampLabel: metadata.timestampLabel } : {}),
  ...(metadata.turnIndex === undefined ? {} : { turnIndex: metadata.turnIndex }),
});

export const attachConversationItem = (event: AgentTimelineEvent, item: AgentConversationItem) => {
  event.conversationItems.push(item);
};

export const buildSession = (
  session: Omit<AgentSession, "parseWarnings" | "parseWarningCount">,
  parseWarnings: AgentParseWarning[],
): AgentSession => ({
  ...session,
  parseWarnings: [...parseWarnings],
  parseWarningCount: parseWarnings.length,
});
