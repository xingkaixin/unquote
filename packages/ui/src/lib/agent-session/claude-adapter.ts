import { truncateAtCodePointBoundary } from "@unquote/core";
import type {
  AgentAdapterBuilder,
  AgentContentBlock,
  AgentConversationRole,
  AgentEventCategory,
  AgentSessionAdapter,
  AgentTimelineEvent,
  AgentTokenUsage,
} from "./types";
import {
  addOptionalNumber,
  addOptionalString,
  attachConversationItem,
  buildSession,
  createBaseEvent,
  getBoolean,
  getString,
  isRecord,
  parseTimestamp,
  readTokenCount,
  stringifyValue,
  truncateBlockText,
  truncatePreview,
} from "./shared";

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
      return toolId ? `tool_result ${truncateAtCodePointBoundary(toolId, 12)}` : "tool_result";
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
          attachConversationItem(event, {
            id: `conv-${line.lineNumber}-tool-result`,
            role: "tool_result",
            turnIndex,
            ...(block ? { block } : {}),
          });
        } else if (!getBoolean(record, "isMeta")) {
          const text = extractClaudeUserText(record);
          const block: AgentContentBlock | undefined = text
            ? { type: "text", text: truncateBlockText(text) }
            : undefined;
          attachConversationItem(event, {
            id: `conv-${line.lineNumber}-user`,
            role: "user",
            turnIndex,
            ...(block ? { block } : {}),
          });
        }
      } else if (type === "assistant") {
        const blocks = extractClaudeContentBlocks(record);
        model = parseClaudeModel(record) ?? model;

        if (blocks.length === 0) {
          attachConversationItem(event, {
            id: `conv-${line.lineNumber}-assistant`,
            role: "assistant",
            turnIndex,
          });
        } else {
          blocks.forEach((block, blockIndex) => {
            attachConversationItem(event, {
              id: `conv-${line.lineNumber}-block-${blockIndex}`,
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
        },
        parseWarnings,
      );
    },
  };
};

export const claudeTranscriptAdapter: AgentSessionAdapter = {
  fileType: "Claude Code",
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
