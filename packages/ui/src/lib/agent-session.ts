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

interface AgentAdapterBuilder {
  push(line: ParsedAgentLine): void;
  finish(parseWarnings: AgentParseWarning[]): AgentSession;
}

interface AgentSessionAdapter {
  detect(samples: ParsedAgentLine[]): number;
  createBuilder(fileName?: string): AgentAdapterBuilder;
}

const detectionLineLimit = 80;
const earlyDetectionLineCount = 20;
const confidentDetectionScore = 0.75;
const finalDetectionScore = 0.5;
const previewLimit = 160;
const blockTextLimit = 8000;

const truncateText = (value: string, limit: number) =>
  value.length <= limit ? value : `${value.slice(0, limit)}... [truncated]`;

const truncatePreview = (value: string) =>
  truncateText(value.replace(/\s+/g, " ").trim(), previewLimit);

const truncateBlockText = (value: string) => truncateText(value, blockTextLimit);

const parseTimestamp = (value: unknown): number | undefined => {
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? undefined : ms;
  }
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const getString = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const getBoolean = (record: Record<string, unknown>, key: string, defaultValue = false) => {
  const value = record[key];
  return typeof value === "boolean" ? value : defaultValue;
};

const getRecordId = (lineNumber: number) => `record-${lineNumber}`;

const addOptionalString = <T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: string | undefined,
) => {
  if (value) {
    target[key] = value as T[K];
  }
};

const addOptionalNumber = <T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: number | undefined,
) => {
  if (typeof value === "number") {
    target[key] = value as T[K];
  }
};

const stringifyValue = (value: unknown) => {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined || value === null) {
    return "";
  }
  return JSON.stringify(value, null, 2);
};

const parseToolArguments = (source: string | undefined): Record<string, unknown> => {
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

const readTokenCount = (usage: Record<string, unknown>, key: string): number | undefined => {
  const value = usage[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const createBaseEvent = (
  line: ParsedAgentLine,
  category: AgentEventCategory,
  kind: string,
  label: string,
  preview: string,
): AgentTimelineEvent => ({
  id: `line-${line.lineNumber}`,
  recordId: getRecordId(line.lineNumber),
  lineNumber: line.lineNumber,
  category,
  kind,
  label,
  preview,
  conversationItemIds: [],
});

const attachConversationItem = (
  event: AgentTimelineEvent,
  items: AgentConversationItem[],
  item: AgentConversationItem,
) => {
  items.push(item);
  event.conversationItemIds.push(item.id);
};

const buildSession = (
  session: Omit<AgentSession, "parseWarnings">,
  parseWarnings: AgentParseWarning[],
): AgentSession => ({ ...session, parseWarnings: [...parseWarnings] });

const claudeMetaTypes = new Set([
  "mode",
  "permission-mode",
  "file-history-snapshot",
  "attachment",
  "ai-title",
  "last-prompt",
  "system",
  "pr-link",
]);

const isClaudeToolResultUser = (record: Record<string, unknown>) => {
  if (record.type !== "user" || !isRecord(record.message)) {
    return false;
  }

  const content = record.message.content;
  if (!Array.isArray(content) || content.length === 0) {
    return false;
  }

  const first = content[0];
  return isRecord(first) && first.type === "tool_result";
};

const extractClaudeUserText = (record: Record<string, unknown>) => {
  if (!isRecord(record.message)) {
    return "";
  }

  const content = record.message.content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (!isRecord(part)) {
        return "";
      }
      if (part.type === "text" && typeof part.text === "string") {
        return part.text;
      }
      if (part.type === "tool_result") {
        return stringifyValue(part.content);
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
};

const extractClaudeContentBlocks = (record: Record<string, unknown>): AgentContentBlock[] => {
  if (!isRecord(record.message) || !Array.isArray(record.message.content)) {
    return [];
  }

  const blocks: AgentContentBlock[] = [];
  for (const part of record.message.content) {
    if (!isRecord(part)) {
      continue;
    }

    if (part.type === "text" && typeof part.text === "string") {
      blocks.push({ type: "text", text: truncateBlockText(part.text) });
    } else if (part.type === "thinking" && typeof part.thinking === "string") {
      blocks.push({ type: "thinking", text: truncateBlockText(part.thinking) });
    } else if (
      part.type === "tool_use" &&
      typeof part.name === "string" &&
      typeof part.id === "string"
    ) {
      const input = isRecord(part.input) ? part.input : {};
      blocks.push({
        type: "tool_use",
        text: truncateBlockText(JSON.stringify(input, null, 2)),
        toolName: part.name,
        toolInput: input,
        toolCallId: part.id,
        status: "pending",
      });
    }
  }
  return blocks;
};

const claudeBlockRole = (block: AgentContentBlock): AgentConversationRole => {
  if (block.type === "thinking") {
    return "thinking";
  }
  if (block.type === "tool_use") {
    return "tool_call";
  }
  return "assistant";
};

const claudeBlockLabel = (block: AgentContentBlock) => {
  if (block.type === "tool_use") {
    return `tool_use ${block.toolName ?? "unknown"}`;
  }
  if (block.type === "thinking") {
    return "thinking";
  }
  return "text";
};

const claudeBlockPreview = (block: AgentContentBlock) => {
  if (block.type === "tool_use") {
    return truncatePreview(`${block.toolName ?? "tool"}: ${block.text}`);
  }
  return truncatePreview(block.text);
};

const claudeCategory = (type: string, record: Record<string, unknown>): AgentEventCategory => {
  if (type === "user") {
    return isClaudeToolResultUser(record) ? "tool" : "user";
  }
  if (type === "assistant") {
    return "assistant";
  }
  if (claudeMetaTypes.has(type)) {
    return "meta";
  }
  return "unknown";
};

const claudeLabel = (type: string, record: Record<string, unknown>) => {
  if (type === "user") {
    if (isClaudeToolResultUser(record) && isRecord(record.message)) {
      const parts = record.message.content;
      const first = Array.isArray(parts) && isRecord(parts[0]) ? parts[0] : undefined;
      const toolId = typeof first?.tool_use_id === "string" ? first.tool_use_id : undefined;
      return toolId ? `tool_result ${toolId.slice(0, 12)}` : "tool_result";
    }
    return "user";
  }

  if (type === "assistant") {
    const blocks = extractClaudeContentBlocks(record);
    if (blocks.length === 1) {
      return claudeBlockLabel(blocks[0]!);
    }
    if (blocks.length > 1) {
      return `assistant (${blocks.length} blocks)`;
    }
    return "assistant";
  }

  return type;
};

const claudePreview = (type: string, record: Record<string, unknown>) => {
  if (type === "user") {
    return truncatePreview(extractClaudeUserText(record));
  }

  if (type === "assistant") {
    const blocks = extractClaudeContentBlocks(record);
    return blocks.length > 0 ? claudeBlockPreview(blocks[0]!) : "";
  }

  if (type === "system" && typeof record.content === "string") {
    return truncatePreview(record.content);
  }

  return "";
};

const parseClaudeTokenUsage = (raw: unknown): AgentTokenUsage | undefined => {
  if (!isRecord(raw) || !isRecord(raw.message) || !isRecord(raw.message.usage)) {
    return undefined;
  }

  const inputTokens = readTokenCount(raw.message.usage, "input_tokens");
  const outputTokens = readTokenCount(raw.message.usage, "output_tokens");
  const cacheCreationInputTokens = readTokenCount(raw.message.usage, "cache_creation_input_tokens");
  const cacheReadInputTokens = readTokenCount(raw.message.usage, "cache_read_input_tokens");
  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    cacheCreationInputTokens === undefined &&
    cacheReadInputTokens === undefined
  ) {
    return undefined;
  }

  return {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    cacheCreationInputTokens: cacheCreationInputTokens ?? 0,
    cacheReadInputTokens: cacheReadInputTokens ?? 0,
  };
};

const parseClaudeModel = (raw: unknown) => {
  if (!isRecord(raw) || !isRecord(raw.message)) {
    return undefined;
  }
  return getString(raw.message, "model");
};

const createClaudeBuilder = (fileName?: string): AgentAdapterBuilder => {
  const events: AgentTimelineEvent[] = [];
  const conversationItems: AgentConversationItem[] = [];
  let turnIndex = 0;
  let lastPromptId: string | undefined;
  let sessionId: string | undefined;
  let model: string | undefined;
  let cwd: string | undefined;
  let version: string | undefined;

  return {
    push(line) {
      if (!isRecord(line.data)) {
        return;
      }

      const record = line.data;
      const type = getString(record, "type") ?? "unknown";
      const promptId = getString(record, "promptId") ?? `line-${line.lineNumber}`;
      sessionId ??= getString(record, "sessionId");
      cwd ??= getString(record, "cwd");
      version ??= getString(record, "version");

      if (type === "user" && promptId !== lastPromptId && !isClaudeToolResultUser(record)) {
        turnIndex += 1;
      }

      const event = createBaseEvent(
        line,
        claudeCategory(type, record),
        type,
        claudeLabel(type, record),
        claudePreview(type, record),
      );
      addOptionalNumber(event, "timestamp", parseTimestamp(record.timestamp));
      addOptionalNumber(event, "turnIndex", turnIndex);
      addOptionalString(event, "requestId", getString(record, "requestId"));
      addOptionalString(event, "model", parseClaudeModel(record));
      addOptionalString(event, "uuid", getString(record, "uuid"));
      addOptionalString(event, "sessionId", getString(record, "sessionId"));
      addOptionalString(event, "cwd", getString(record, "cwd"));
      addOptionalString(event, "timestampLabel", getString(record, "timestamp"));

      if (isRecord(record.message)) {
        addOptionalString(event, "role", getString(record.message, "role"));
        addOptionalString(event, "stopReason", getString(record.message, "stop_reason"));
      }

      const usage = parseClaudeTokenUsage(record);
      if (usage) {
        event.usage = usage;
      }

      if (type === "user") {
        lastPromptId = promptId;
        if (isClaudeToolResultUser(record) && isRecord(record.message)) {
          const parts = record.message.content;
          const first = Array.isArray(parts) && isRecord(parts[0]) ? parts[0] : undefined;
          const text = extractClaudeUserText(record);
          const block: AgentContentBlock | undefined = text
            ? {
                type: "text",
                text: truncateBlockText(text),
                status: first?.is_error === true ? "failed" : "completed",
                ...(typeof first?.tool_use_id === "string"
                  ? { toolCallId: first.tool_use_id }
                  : {}),
              }
            : undefined;
          attachConversationItem(event, conversationItems, {
            id: `conv-${line.lineNumber}-tool-result`,
            eventId: event.id,
            recordId: event.recordId,
            lineNumber: line.lineNumber,
            role: "tool_result",
            turnIndex,
            ...(block ? { block } : {}),
          });
        } else if (!getBoolean(record, "isMeta")) {
          const text = extractClaudeUserText(record);
          const block: AgentContentBlock | undefined = text
            ? { type: "text", text: truncateBlockText(text) }
            : undefined;
          attachConversationItem(event, conversationItems, {
            id: `conv-${line.lineNumber}-user`,
            eventId: event.id,
            recordId: event.recordId,
            lineNumber: line.lineNumber,
            role: "user",
            turnIndex,
            ...(block ? { block } : {}),
          });
        }
      } else if (type === "assistant") {
        const blocks = extractClaudeContentBlocks(record);
        model = parseClaudeModel(record) ?? model;

        if (blocks.length === 0) {
          attachConversationItem(event, conversationItems, {
            id: `conv-${line.lineNumber}-assistant`,
            eventId: event.id,
            recordId: event.recordId,
            lineNumber: line.lineNumber,
            role: "assistant",
            turnIndex,
          });
        } else {
          blocks.forEach((block, blockIndex) => {
            attachConversationItem(event, conversationItems, {
              id: `conv-${line.lineNumber}-block-${blockIndex}`,
              eventId: event.id,
              recordId: event.recordId,
              lineNumber: line.lineNumber,
              role: claudeBlockRole(block),
              turnIndex,
              block,
            });
          });
        }
      }

      events.push(event);
    },
    finish(parseWarnings) {
      return buildSession(
        {
          fileType: "Claude Code",
          ...(fileName ? { fileName } : {}),
          meta: {
            eventCount: events.length,
            turnCount: turnIndex,
            ...(sessionId ? { sessionId } : {}),
            ...(model ? { model } : {}),
            ...(cwd ? { cwd } : {}),
            ...(version ? { version } : {}),
          },
          events,
          conversationItems,
        },
        parseWarnings,
      );
    },
  };
};

const codexEnvelopeTypes = new Set(["session_meta", "event_msg", "response_item", "turn_context"]);

const extractCodexMessageText = (content: unknown) => {
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (!isRecord(part)) {
        return "";
      }
      if (
        (part.type === "input_text" || part.type === "output_text") &&
        typeof part.text === "string"
      ) {
        return part.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
};

const extractCodexReasoningText = (payload: Record<string, unknown>) => {
  if (!Array.isArray(payload.summary)) {
    return "encrypted reasoning";
  }

  const summary = payload.summary
    .map((entry) => (isRecord(entry) ? (getString(entry, "text") ?? "") : ""))
    .filter(Boolean)
    .join("\n");
  return summary || "encrypted reasoning";
};

const shortCallId = (callId: string | undefined) =>
  callId && callId.length > 12 ? callId.slice(0, 12) : callId;

const codexMessageRole = (role: string | undefined): AgentConversationRole => {
  if (role === "developer" || role === "system") {
    return "system";
  }
  if (role === "user") {
    return "user";
  }
  if (role === "assistant") {
    return "assistant";
  }
  return "system";
};

const codexMessageCategory = (role: string | undefined): AgentEventCategory => {
  if (role === "developer" || role === "system") {
    return "system";
  }
  if (role === "user") {
    return "user";
  }
  if (role === "assistant") {
    return "assistant";
  }
  return "unknown";
};

const codexResponseItemType = (payload: Record<string, unknown>) =>
  getString(payload, "type") ?? "response_item";

const isFailedCodexToolOutput = (payload: Record<string, unknown>) => {
  const output = getString(payload, "output");
  if (output) {
    try {
      const parsed = JSON.parse(output) as unknown;
      if (
        isRecord(parsed) &&
        isRecord(parsed.metadata) &&
        typeof parsed.metadata.exit_code === "number"
      ) {
        return parsed.metadata.exit_code !== 0;
      }
    } catch {}
  }

  return getString(payload, "status") === "failed";
};

const codexResponseBlock = (
  payload: Record<string, unknown>,
  itemType: string,
): AgentContentBlock | undefined => {
  if (itemType === "message") {
    const text = extractCodexMessageText(payload.content);
    return text ? { type: "text", text: truncateBlockText(text) } : undefined;
  }

  if (itemType === "reasoning") {
    return { type: "thinking", text: truncateBlockText(extractCodexReasoningText(payload)) };
  }

  if (itemType === "function_call" || itemType === "custom_tool_call") {
    const toolName = getString(payload, "name") ?? "tool";
    const callId = getString(payload, "call_id");
    const argsSource =
      itemType === "function_call" ? getString(payload, "arguments") : getString(payload, "input");
    const toolInput = parseToolArguments(argsSource);
    return {
      type: "tool_use",
      text: truncateBlockText(argsSource ?? JSON.stringify(toolInput, null, 2)),
      toolName,
      toolInput,
      ...(callId ? { toolCallId: callId } : {}),
      status: "pending",
    };
  }

  if (itemType === "function_call_output" || itemType === "custom_tool_call_output") {
    const text = truncateBlockText(stringifyValue(payload.output));
    const callId = getString(payload, "call_id");
    if (!text) {
      return undefined;
    }
    return {
      type: "text",
      text,
      ...(callId ? { toolCallId: callId } : {}),
      status: isFailedCodexToolOutput(payload) ? "failed" : "completed",
    };
  }

  return undefined;
};

const codexResponseRole = (itemType: string, role: string | undefined): AgentConversationRole => {
  if (itemType === "message") {
    return codexMessageRole(role);
  }
  if (itemType === "reasoning") {
    return "thinking";
  }
  if (itemType === "function_call" || itemType === "custom_tool_call") {
    return "tool_call";
  }
  if (itemType === "function_call_output" || itemType === "custom_tool_call_output") {
    return "tool_result";
  }
  return "system";
};

const codexResponseItemId = (lineNumber: number, itemType: string, role: string | undefined) => {
  if (itemType === "message") {
    return `conv-${lineNumber}-${codexMessageRole(role)}`;
  }
  if (itemType === "reasoning") {
    return `conv-${lineNumber}-thinking`;
  }
  if (itemType === "function_call" || itemType === "custom_tool_call") {
    return `conv-${lineNumber}-tool-call`;
  }
  if (itemType === "function_call_output" || itemType === "custom_tool_call_output") {
    return `conv-${lineNumber}-tool-result`;
  }
  return `conv-${lineNumber}-response-item`;
};

const codexKind = (envelopeType: string, payload: Record<string, unknown>) => {
  if (envelopeType === "event_msg") {
    return getString(payload, "type") ?? "event_msg";
  }
  if (envelopeType === "response_item") {
    return codexResponseItemType(payload);
  }
  return envelopeType;
};

const codexCategory = (
  envelopeType: string,
  payload: Record<string, unknown>,
): AgentEventCategory => {
  if (envelopeType === "session_meta" || envelopeType === "turn_context") {
    return "meta";
  }

  if (envelopeType === "event_msg") {
    const kind = getString(payload, "type") ?? "event_msg";
    if (kind === "user_message") {
      return "user";
    }
    if (kind === "agent_message") {
      return "assistant";
    }
    if (kind === "task_started" || kind === "task_complete" || kind === "token_count") {
      return "meta";
    }
    return "unknown";
  }

  if (envelopeType === "response_item") {
    const itemType = codexResponseItemType(payload);
    if (itemType === "message") {
      return codexMessageCategory(getString(payload, "role"));
    }
    if (itemType === "reasoning") {
      return "thinking";
    }
    if (
      itemType === "function_call" ||
      itemType === "custom_tool_call" ||
      itemType === "function_call_output" ||
      itemType === "custom_tool_call_output"
    ) {
      return "tool";
    }
  }

  return "unknown";
};

const codexLabel = (envelopeType: string, payload: Record<string, unknown>) => {
  if (envelopeType === "session_meta" || envelopeType === "turn_context") {
    return envelopeType;
  }

  if (envelopeType === "event_msg") {
    return getString(payload, "type") ?? "event_msg";
  }

  if (envelopeType === "response_item") {
    const itemType = codexResponseItemType(payload);
    if (itemType === "message") {
      return getString(payload, "role") ?? "message";
    }
    if (itemType === "reasoning") {
      return "reasoning";
    }
    if (itemType === "function_call" || itemType === "custom_tool_call") {
      return `tool_use ${getString(payload, "name") ?? "tool"}`;
    }
    if (itemType === "function_call_output" || itemType === "custom_tool_call_output") {
      return `tool_result ${shortCallId(getString(payload, "call_id")) ?? "unknown"}`;
    }
    return itemType;
  }

  return envelopeType;
};

const codexPreview = (
  envelopeType: string,
  payload: Record<string, unknown>,
  sessionId: string | undefined,
  cwd: string | undefined,
) => {
  if (envelopeType === "session_meta") {
    return truncatePreview(sessionId ?? cwd ?? "");
  }
  if (envelopeType === "turn_context") {
    return truncatePreview(
      [getString(payload, "model"), getString(payload, "cwd")].filter(Boolean).join(" - "),
    );
  }
  if (envelopeType === "event_msg") {
    return truncatePreview(getString(payload, "message") ?? getString(payload, "turn_id") ?? "");
  }
  if (envelopeType !== "response_item") {
    return "";
  }

  const itemType = codexResponseItemType(payload);
  if (itemType === "message") {
    return truncatePreview(extractCodexMessageText(payload.content));
  }
  if (itemType === "reasoning") {
    return truncatePreview(extractCodexReasoningText(payload));
  }
  if (itemType === "function_call" || itemType === "custom_tool_call") {
    return truncatePreview(getString(payload, "arguments") ?? getString(payload, "input") ?? "");
  }
  if (itemType === "function_call_output" || itemType === "custom_tool_call_output") {
    return truncatePreview(stringifyValue(payload.output));
  }
  return "";
};

const createCodexBuilder = (fileName?: string): AgentAdapterBuilder => {
  const events: AgentTimelineEvent[] = [];
  const conversationItems: AgentConversationItem[] = [];
  const turnIdToIndex = new Map<string, number>();
  let sessionId: string | undefined;
  let cwd: string | undefined;
  let version: string | undefined;
  let model: string | undefined;
  let currentTurnId: string | undefined;
  const defaultTurnIndex = 1;

  const registerTurn = (turnId: string) => {
    const existing = turnIdToIndex.get(turnId);
    if (existing !== undefined) {
      return existing;
    }
    const nextIndex = turnIdToIndex.size + 1;
    turnIdToIndex.set(turnId, nextIndex);
    return nextIndex;
  };

  const currentTurnIndex = () => (currentTurnId ? registerTurn(currentTurnId) : defaultTurnIndex);

  return {
    push(line) {
      if (!isRecord(line.data)) {
        return;
      }

      const envelope = line.data;
      const envelopeType = getString(envelope, "type") ?? "unknown";
      const payload = envelope.payload;
      if (!isRecord(payload)) {
        return;
      }

      if (envelopeType === "session_meta") {
        sessionId ??= getString(payload, "session_id") ?? getString(payload, "id");
        cwd ??= getString(payload, "cwd");
        version ??= getString(payload, "cli_version");
      }

      if (envelopeType === "turn_context") {
        const turnId = getString(payload, "turn_id");
        if (turnId) {
          currentTurnId = turnId;
        }
        cwd ??= getString(payload, "cwd");
        model = getString(payload, "model") ?? model;
      }

      if (envelopeType === "event_msg" && getString(payload, "type") === "task_started") {
        const turnId = getString(payload, "turn_id");
        if (turnId) {
          currentTurnId = turnId;
        }
      }

      const turnIndex = currentTurnIndex();
      const itemType =
        envelopeType === "response_item" ? codexResponseItemType(payload) : undefined;
      const messageRole =
        envelopeType === "response_item" && itemType === "message"
          ? getString(payload, "role")
          : undefined;
      const event = createBaseEvent(
        line,
        codexCategory(envelopeType, payload),
        codexKind(envelopeType, payload),
        codexLabel(envelopeType, payload),
        codexPreview(envelopeType, payload, sessionId, cwd),
      );
      addOptionalNumber(event, "timestamp", parseTimestamp(envelope.timestamp));
      addOptionalNumber(event, "turnIndex", turnIndex);
      addOptionalString(
        event,
        "model",
        envelopeType === "turn_context" ? getString(payload, "model") : model,
      );
      addOptionalString(event, "timestampLabel", getString(envelope, "timestamp"));
      addOptionalString(event, "role", messageRole);
      if (envelopeType === "session_meta") {
        addOptionalString(event, "sessionId", sessionId);
        addOptionalString(event, "cwd", getString(payload, "cwd") ?? cwd);
      } else if (envelopeType === "turn_context") {
        addOptionalString(event, "cwd", getString(payload, "cwd") ?? cwd);
      }

      if (envelopeType === "response_item" && itemType) {
        const block = codexResponseBlock(payload, itemType);
        attachConversationItem(event, conversationItems, {
          id: codexResponseItemId(line.lineNumber, itemType, messageRole),
          eventId: event.id,
          recordId: event.recordId,
          lineNumber: line.lineNumber,
          role: codexResponseRole(itemType, messageRole),
          turnIndex,
          ...(block ? { block } : {}),
        });
      }

      events.push(event);
    },
    finish(parseWarnings) {
      const turnCount =
        turnIdToIndex.size > 0 ? turnIdToIndex.size : conversationItems.length > 0 ? 1 : 0;
      return buildSession(
        {
          fileType: "Codex",
          ...(fileName ? { fileName } : {}),
          meta: {
            eventCount: events.length,
            turnCount,
            ...(sessionId ? { sessionId } : {}),
            ...(model ? { model } : {}),
            ...(cwd ? { cwd } : {}),
            ...(version ? { version } : {}),
          },
          events,
          conversationItems,
        },
        parseWarnings,
      );
    },
  };
};

const claudeTranscriptAdapter: AgentSessionAdapter = {
  detect(samples) {
    if (samples.length === 0) {
      return 0;
    }

    let transcriptHits = 0;
    let metaHits = 0;
    for (const sample of samples) {
      if (!isRecord(sample.data)) {
        continue;
      }

      const type = getString(sample.data, "type");
      if (
        (type === "user" || type === "assistant") &&
        getString(sample.data, "uuid") &&
        isRecord(sample.data.message)
      ) {
        transcriptHits += 1;
      } else if (type && claudeMetaTypes.has(type) && getString(sample.data, "sessionId")) {
        metaHits += 1;
      }
    }

    if (transcriptHits >= 2) {
      return Math.min(1, 0.65 + transcriptHits / Math.max(samples.length, 20));
    }
    if (transcriptHits === 1 && metaHits >= 1) {
      return 0.6;
    }
    return 0;
  },
  createBuilder: createClaudeBuilder,
};

const codexRolloutAdapter: AgentSessionAdapter = {
  detect(samples) {
    if (samples.length === 0) {
      return 0;
    }

    let hits = 0;
    for (const sample of samples) {
      if (!isRecord(sample.data)) {
        continue;
      }
      const type = getString(sample.data, "type");
      if (type && codexEnvelopeTypes.has(type) && isRecord(sample.data.payload)) {
        hits += 1;
      }
    }

    return hits / samples.length;
  },
  createBuilder: createCodexBuilder,
};

const adapters: AgentSessionAdapter[] = [codexRolloutAdapter, claudeTranscriptAdapter];

const selectAdapter = (samples: ParsedAgentLine[], minScore: number) => {
  let bestAdapter: AgentSessionAdapter | null = null;
  let bestScore = 0;

  for (const adapter of adapters) {
    const score = adapter.detect(samples);
    if (score > bestScore) {
      bestScore = score;
      bestAdapter = adapter;
    }
  }

  return bestAdapter && bestScore >= minScore ? bestAdapter : null;
};

export const detectAgentSession = (samples: ParsedAgentLine[]) => {
  const adapter = selectAdapter(samples, finalDetectionScore);
  if (!adapter) {
    return null;
  }

  if (adapter === codexRolloutAdapter) {
    return "Codex" as const;
  }
  return "Claude Code" as const;
};

export const createAgentSessionTracker = (fileName?: string) => {
  const samples: ParsedAgentLine[] = [];
  const parseWarnings: AgentParseWarning[] = [];
  let builder: AgentAdapterBuilder | null = null;
  let disabled = false;

  const startBuilder = (adapter: AgentSessionAdapter) => {
    builder = adapter.createBuilder(fileName);
    for (const sample of samples) {
      builder.push(sample);
    }
    samples.splice(0, samples.length);
  };

  const tryDetect = (minScore: number) => {
    const adapter = selectAdapter(samples, minScore);
    if (adapter) {
      startBuilder(adapter);
      return true;
    }
    return false;
  };

  const pushParsedLine = (line: ParsedAgentLine) => {
    if (disabled) {
      return;
    }

    if (builder) {
      builder.push(line);
      return;
    }

    samples.push(line);
    if (samples.length >= earlyDetectionLineCount && tryDetect(confidentDetectionScore)) {
      return;
    }
    if (samples.length >= detectionLineLimit && !tryDetect(finalDetectionScore)) {
      disabled = true;
      samples.splice(0, samples.length);
    }
  };

  return {
    pushRawLine(raw: string, lineNumber: number) {
      if (disabled || !raw.trim()) {
        return;
      }

      try {
        pushParsedLine({ lineNumber, raw, data: JSON.parse(raw) as unknown });
      } catch {
        parseWarnings.push({ lineNumber, message: "Invalid JSON on this line" });
      }
    },

    finish() {
      if (!builder && !disabled) {
        tryDetect(finalDetectionScore);
      }
      return builder ? builder.finish(parseWarnings) : null;
    },
  };
};

export const createAgentSessionFromText = (text: string, fileName?: string) => {
  const tracker = createAgentSessionTracker(fileName);
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => tracker.pushRawLine(line.trim(), index + 1));
  return tracker.finish();
};
