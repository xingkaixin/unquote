import { truncateAtCodePointBoundary } from "@unquote/core";
import type {
  AgentAdapterBuilder,
  AgentContentBlock,
  AgentConversationItem,
  AgentConversationRole,
  AgentEventCategory,
  AgentSessionAdapter,
  AgentTimelineEvent,
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

const parseClaudeUsage = (
  record: Record<string, unknown>,
): AgentTrajectoryTokenUsage | undefined => {
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

  return trajectory;
};

const claudeBlockEvidence = (
  items: AgentConversationItem[],
  turnId: string | undefined,
  usage: AgentTrajectoryTokenUsage | undefined,
): AgentTrajectoryEvidence[] => {
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
  return evidence;
};

const claudeTurnDurationMs = (record: Record<string, unknown>) => {
  const value = record.durationMs;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
};

const parseClaudeModel = (raw: unknown) => {
  if (!isRecord(raw) || !isRecord(raw.message)) {
    return undefined;
  }
  return getString(raw.message, "model");
};

interface ClaudeTurnState {
  index: number;
  turnId?: string;
  closed: boolean;
  lastTimestamp?: number;
}

const createClaudeBuilder = (fileName?: string): AgentAdapterBuilder => {
  const events: AgentTimelineEvent[] = [];
  const seenUsageRequestIds = new Set<string>();
  let currentTurn: ClaudeTurnState | undefined;
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
      closed: false,
      ...(turnId === undefined ? {} : { turnId }),
    };
  };

  // A new prompt proves the previous turn ended; close it at its own last
  // known moment rather than the idle gap before this prompt.
  const promptTurnLifecycle = (promptId: string | undefined): AgentTrajectoryEvidence[] => {
    const previous = currentTurn;
    startPromptTurn(promptId);
    if (currentTurn === previous) {
      return [];
    }

    const lifecycle: AgentTrajectoryEvidence[] = [];
    if (
      previous &&
      !previous.closed &&
      previous.turnId !== undefined &&
      previous.lastTimestamp !== undefined
    ) {
      lifecycle.push({
        kind: "turn-lifecycle",
        phase: "complete",
        turnId: previous.turnId,
        timestamp: previous.lastTimestamp,
      });
    }
    lifecycle.push({
      kind: "turn-lifecycle",
      phase: "start",
      ...(currentTurn?.turnId === undefined ? {} : { turnId: currentTurn.turnId }),
    });
    return lifecycle;
  };

  const closeCurrentTurn = (durationMs?: number): AgentTrajectoryEvidence[] => {
    if (!currentTurn) {
      return [];
    }
    currentTurn.closed = true;
    return [
      {
        kind: "turn-lifecycle",
        phase: "complete",
        ...(currentTurn.turnId === undefined ? {} : { turnId: currentTurn.turnId }),
        ...(durationMs === undefined ? {} : { durationMs }),
      },
    ];
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
      const timestamp = parseTimestamp(record.timestamp);

      let leadingLifecycle: AgentTrajectoryEvidence[] = [];
      if (type === "user" && !isToolResultTurn) {
        leadingLifecycle = promptTurnLifecycle(getString(record, "promptId"));
      }
      if (currentTurn && timestamp !== undefined) {
        if (currentTurn.lastTimestamp === undefined || timestamp > currentTurn.lastTimestamp) {
          currentTurn.lastTimestamp = timestamp;
        }
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
      addOptionalNumber(event, "timestamp", timestamp);
      addOptionalNumber(event, "turnIndex", turnIndex);
      addOptionalString(event, "timestampLabel", getString(record, "timestamp"));

      const usage = parseClaudeUsage(record);

      // One API response spans several records that repeat the same usage
      // object, so only the request's first record contributes to totals.
      let trajectoryUsage = usage;
      const requestId = getString(record, "requestId");
      if (trajectoryUsage && requestId) {
        if (seenUsageRequestIds.has(requestId)) {
          trajectoryUsage = undefined;
        } else {
          seenUsageRequestIds.add(requestId);
        }
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
        const stopReason = isRecord(record.message)
          ? getString(record.message, "stop_reason")
          : undefined;
        const trailingLifecycle =
          type === "assistant" && stopReason === "end_turn" ? closeCurrentTurn() : [];
        const evidence = [
          ...leadingLifecycle,
          ...claudeBlockEvidence(items, turnId, trajectoryUsage),
          ...trailingLifecycle,
        ];
        if (evidence.length > 0) {
          event.trajectoryEvidence = evidence;
        }
      } else if (type === "system") {
        const subtype = getString(record, "subtype");
        if (subtype === "turn_duration" && currentTurn) {
          event.trajectoryEvidence = closeCurrentTurn(claudeTurnDurationMs(record));
        } else if (subtype === "compact_boundary") {
          event.trajectoryEvidence = [
            { kind: "compaction", ...(turnId === undefined ? {} : { turnId }) },
          ];
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
      if (
        (sample.type === "user" || sample.type === "assistant") &&
        sample.hasUuid &&
        sample.hasObjectMessage
      ) {
        transcriptHits += 1;
      } else if (sample.type && claudeMetaTypes.has(sample.type) && sample.hasSessionId) {
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
