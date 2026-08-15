import { truncateAtCodePointBoundary } from "@unquote/core";
import type {
  AgentAdapterBuilder,
  AgentContentBlock,
  AgentConversationItem,
  AgentConversationRole,
  AgentEventCategory,
  AgentSessionAdapter,
  AgentTimelineEvent,
  AgentTokenUsage,
  AgentTrajectoryEvidence,
  AgentTrajectoryTokenUsage,
} from "./types";
import { formatAgentBlockValue, truncateBlockText, truncatePreview } from "./agent-value-format";
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

/**
 * The single normalization pass for a record's message content. The label,
 * preview, category, and conversation items are all derived from this result,
 * so the raw record is never re-read per consumer.
 */
const extractClaudeContentBlocks = (record: Record<string, unknown>): AgentContentBlock[] => {
  if (!isRecord(record.message)) {
    return [];
  }

  const content = record.message.content;
  if (typeof content === "string") {
    return content ? [{ type: "text", text: truncateBlockText(content) }] : [];
  }
  if (!Array.isArray(content)) {
    return [];
  }

  const blocks: AgentContentBlock[] = [];
  for (const part of content) {
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
        text: formatAgentBlockValue(input),
        toolName: part.name,
        toolCallId: part.id,
      });
    } else if (part.type === "tool_result") {
      // Parallel tool calls answer with one tool_result block per call, so each
      // block keeps its own id, status, and text rather than being merged.
      blocks.push({
        type: "tool_result",
        text: formatAgentBlockValue(part.content),
        status: part.is_error === true ? "failed" : "completed",
        ...(typeof part.tool_use_id === "string" ? { toolCallId: part.tool_use_id } : {}),
      });
    }
  }
  return blocks;
};

const claudeBlockRole = (
  block: AgentContentBlock,
  textRole: AgentConversationRole,
): AgentConversationRole => {
  switch (block.type) {
    case "thinking":
      return "thinking";
    case "tool_use":
      return "tool_call";
    case "tool_result":
      return "tool_result";
    case "text":
      return textRole;
  }
};

const claudeBlockLabel = (block: AgentContentBlock) => {
  switch (block.type) {
    case "tool_use":
      return `tool_use ${block.toolName}`;
    case "thinking":
      return "thinking";
    case "tool_result":
      return block.toolCallId
        ? `tool_result ${truncateAtCodePointBoundary(block.toolCallId, 12)}`
        : "tool_result";
    case "text":
      return "text";
  }
};

const claudeBlocksLabel = (blocks: AgentContentBlock[], fallback: string) => {
  if (blocks.length === 1) {
    return claudeBlockLabel(blocks[0]!);
  }
  return blocks.length > 1 ? `${fallback} (${blocks.length} blocks)` : fallback;
};

const attachBlockItems = (
  event: AgentTimelineEvent,
  blocks: AgentContentBlock[],
  turnIndex: number | undefined,
  textRole: AgentConversationRole,
) => {
  const items: AgentConversationItem[] = [];
  const attach = (item: AgentConversationItem) => {
    attachConversationItem(event, item);
    items.push(item);
  };

  if (blocks.length === 0) {
    attach({
      id: `conv-${event.lineNumber}-${textRole}`,
      role: textRole,
      ...(turnIndex === undefined ? {} : { turnIndex }),
    });
    return items;
  }

  blocks.forEach((block, blockIndex) => {
    attach({
      id: `conv-${event.lineNumber}-block-${blockIndex}`,
      role: claudeBlockRole(block, textRole),
      ...(turnIndex === undefined ? {} : { turnIndex }),
      block,
    });
  });

  return items;
};

const claudeBlockPreview = (block: AgentContentBlock) => {
  if (block.type === "tool_use") {
    return truncatePreview(`${block.toolName}: ${block.text}`);
  }
  return truncatePreview(block.text);
};

const claudeCategory = (type: string, isToolResultTurn: boolean): AgentEventCategory => {
  if (type === "user") {
    return isToolResultTurn ? "tool" : "user";
  }
  if (type === "assistant") {
    return "assistant";
  }
  if (claudeMetaTypes.has(type)) {
    return "meta";
  }
  return "unknown";
};

const claudeLabel = (type: string, blocks: AgentContentBlock[], isToolResultTurn: boolean) => {
  if (type === "user") {
    return isToolResultTurn ? claudeBlocksLabel(blocks, "tool_result") : "user";
  }

  if (type === "assistant") {
    return claudeBlocksLabel(blocks, "assistant");
  }

  return type;
};

const claudePreview = (
  type: string,
  record: Record<string, unknown>,
  blocks: AgentContentBlock[],
) => {
  if (type === "user") {
    return truncatePreview(
      blocks
        .map((block) => block.text)
        .filter(Boolean)
        .join("\n"),
    );
  }

  if (type === "assistant") {
    return blocks.length > 0 ? claudeBlockPreview(blocks[0]!) : "";
  }

  if (type === "system" && typeof record.content === "string") {
    return truncatePreview(record.content);
  }

  return "";
};

interface ClaudeUsage {
  display: AgentTokenUsage;
  trajectory: AgentTrajectoryTokenUsage;
}

const parseClaudeUsage = (record: Record<string, unknown>): ClaudeUsage | undefined => {
  const message = record.message;
  if (!isRecord(message)) {
    return undefined;
  }

  const rawUsage = message.usage;
  if (!isRecord(rawUsage)) {
    return undefined;
  }

  const inputTokens = readTokenCount(rawUsage, "input_tokens");
  const outputTokens = readTokenCount(rawUsage, "output_tokens");
  const cacheCreationInputTokens = readTokenCount(rawUsage, "cache_creation_input_tokens");
  const cacheReadInputTokens = readTokenCount(rawUsage, "cache_read_input_tokens");
  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    cacheCreationInputTokens === undefined &&
    cacheReadInputTokens === undefined
  ) {
    return undefined;
  }

  const trajectory: AgentTrajectoryTokenUsage = {};
  if (inputTokens !== undefined) {
    trajectory.inputTokens = inputTokens;
  }
  if (cacheCreationInputTokens !== undefined) {
    trajectory.cacheCreationInputTokens = cacheCreationInputTokens;
  }
  if (cacheReadInputTokens !== undefined) {
    trajectory.cacheReadInputTokens = cacheReadInputTokens;
  }
  if (outputTokens !== undefined) {
    trajectory.outputTokens = outputTokens;
  }

  return {
    display: {
      inputTokens: inputTokens ?? 0,
      outputTokens: outputTokens ?? 0,
      cacheCreationInputTokens: cacheCreationInputTokens ?? 0,
      cacheReadInputTokens: cacheReadInputTokens ?? 0,
    },
    trajectory,
  };
};

const appendClaudeTrajectoryEvidence = (
  event: AgentTimelineEvent,
  items: AgentConversationItem[],
  turnId: string | undefined,
  usage: AgentTrajectoryTokenUsage | undefined,
) => {
  const evidence: AgentTrajectoryEvidence[] = [];
  const turn = turnId ? { turnId } : {};

  for (const item of items) {
    const block = item.block;
    if (!block || block.type === "text") {
      const role =
        item.role === "user" ? "user" : item.role === "assistant" ? "assistant" : undefined;
      if (role) {
        evidence.push({
          kind: "model-output",
          role,
          conversationItemId: item.id,
          ...turn,
        });
      }
      continue;
    }

    if (block.type === "thinking") {
      evidence.push({
        kind: "model-output",
        role: "reasoning",
        conversationItemId: item.id,
        ...turn,
      });
      continue;
    }

    if (block.type === "tool_use") {
      evidence.push({
        kind: "tool-lifecycle",
        phase: "call",
        toolName: block.toolName,
        conversationItemId: item.id,
        ...(block.toolCallId ? { callId: block.toolCallId } : {}),
        ...turn,
      });
      continue;
    }

    evidence.push({
      kind: "tool-lifecycle",
      phase: "result",
      status: block.status,
      conversationItemId: item.id,
      ...(block.toolCallId ? { callId: block.toolCallId } : {}),
      ...turn,
    });
  }

  if (usage) {
    evidence.push({ kind: "token-usage", usage, ...turn });
  }
  if (evidence.length > 0) {
    event.trajectoryEvidence = evidence;
  }
};

const parseClaudeModel = (raw: unknown) => {
  if (!isRecord(raw) || !isRecord(raw.message)) {
    return undefined;
  }
  return getString(raw.message, "model");
};

const createClaudeBuilder = (fileName?: string): AgentAdapterBuilder => {
  const events: AgentTimelineEvent[] = [];
  let currentTurn: { index: number; turnId?: string } | undefined;
  let turnCount = 0;
  let sessionId: string | undefined;
  let model: string | undefined;
  let cwd: string | undefined;
  let version: string | undefined;

  const startPromptTurn = (turnId: string | undefined) => {
    if (turnId !== undefined && currentTurn?.turnId === turnId) {
      return;
    }
    turnCount += 1;
    currentTurn = {
      index: turnCount,
      ...(turnId === undefined ? {} : { turnId }),
    };
  };

  return {
    push(line) {
      if (!isRecord(line.data)) {
        return;
      }

      const record = line.data;
      const type = getString(record, "type") ?? "unknown";
      sessionId ??= getString(record, "sessionId");
      cwd ??= getString(record, "cwd");
      version ??= getString(record, "version");

      const blocks = extractClaudeContentBlocks(record);
      const isToolResultTurn =
        type === "user" && blocks.some((block) => block.type === "tool_result");

      if (type === "user" && !isToolResultTurn) {
        startPromptTurn(getString(record, "promptId"));
      }
      // Records before the first user prompt belong to no turn, so they carry
      // no number rather than a fabricated turn 0.
      const turnIndex = currentTurn?.index;
      const turnId = currentTurn?.turnId;

      const event = createBaseEvent(
        line,
        claudeCategory(type, isToolResultTurn),
        type,
        claudeLabel(type, blocks, isToolResultTurn),
        claudePreview(type, record, blocks),
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

      const usage = parseClaudeUsage(record);
      if (usage) {
        event.usage = usage.display;
      }

      let items: AgentConversationItem[] = [];
      if (type === "user") {
        if (isToolResultTurn || !getBoolean(record, "isMeta")) {
          items = attachBlockItems(event, blocks, turnIndex, "user");
        }
      } else if (type === "assistant") {
        model = parseClaudeModel(record) ?? model;
        items = attachBlockItems(event, blocks, turnIndex, "assistant");
      }

      if (type === "user" || type === "assistant") {
        appendClaudeTrajectoryEvidence(event, items, turnId, usage?.trajectory);
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
            turnCount,
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
