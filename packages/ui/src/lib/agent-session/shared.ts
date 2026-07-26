import type {
  AgentConversationItem,
  AgentEventCategory,
  AgentParseWarning,
  AgentSession,
  AgentTimelineEvent,
  ParsedAgentLine,
} from "./types";

const previewLimit = 160;
const blockTextLimit = 8000;

export const truncateText = (value: string, limit: number) =>
  value.length <= limit ? value : `${value.slice(0, limit)}... [truncated]`;

export const truncatePreview = (value: string) =>
  truncateText(value.replace(/\s+/g, " ").trim(), previewLimit);

export const truncateBlockText = (value: string) => truncateText(value, blockTextLimit);

export const parseTimestamp = (value: unknown): number | undefined => {
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? undefined : ms;
  }
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const getString = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

export const getBoolean = (record: Record<string, unknown>, key: string, defaultValue = false) => {
  const value = record[key];
  return typeof value === "boolean" ? value : defaultValue;
};

const getRecordId = (lineNumber: number) => `record-${lineNumber}`;

export const addOptionalString = <T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: string | undefined,
) => {
  if (value) {
    target[key] = value as T[K];
  }
};

export const addOptionalNumber = <T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: number | undefined,
) => {
  if (typeof value === "number") {
    target[key] = value as T[K];
  }
};

export const stringifyValue = (value: unknown) => {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined || value === null) {
    return "";
  }
  return JSON.stringify(value, null, 2);
};

export const parseToolArguments = (source: string | undefined): Record<string, unknown> => {
  if (!source) {
    return {};
  }

  try {
    const parsed = JSON.parse(source) as unknown;
    return isRecord(parsed) ? parsed : { raw: source };
  } catch {
    return { raw: source };
  }
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
): AgentTimelineEvent => ({
  id: `line-${line.lineNumber}`,
  recordId: getRecordId(line.lineNumber),
  lineNumber: line.lineNumber,
  rawLine: line.raw,
  category,
  kind,
  label,
  preview,
  conversationItems: [],
});

export const attachConversationItem = (event: AgentTimelineEvent, item: AgentConversationItem) => {
  event.conversationItems.push(item);
};

export const buildSession = (
  session: Omit<AgentSession, "parseWarnings">,
  parseWarnings: AgentParseWarning[],
): AgentSession => ({ ...session, parseWarnings: [...parseWarnings] });
