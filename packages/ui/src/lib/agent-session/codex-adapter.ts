import { truncateAtCodePointBoundary } from "@unquote/core";
import type {
  AgentAdapterBuilder,
  AgentContentBlock,
  AgentConversationRole,
  AgentEventCategory,
  AgentModelOutputEvidence,
  AgentSessionAdapter,
  AgentTimelineEvent,
  AgentTrajectoryEvidence,
} from "./types";
import {
  formatAgentBlockValue,
  formatAgentPreviewValue,
  truncateBlockText,
  truncatePreview,
} from "./agent-value-format";
import {
  addOptionalNumber,
  addOptionalString,
  attachConversationItem,
  buildSession,
  createBaseEvent,
  getString,
  isRecord,
  parseTimestamp,
  readTokenCount,
} from "./shared";

const codexEnvelopeTypes = new Set([
  "session_meta",
  "event_msg",
  "response_item",
  "turn_context",
  "compacted",
]);

const codexToolCompletionEventTypes = new Set([
  "mcp_tool_call_end",
  "patch_apply_end",
  "web_search_end",
]);

const codexPayloadTurnEventTypes = new Set([
  "task_started",
  "task_complete",
  "turn_aborted",
  "token_count",
  "sub_agent_activity",
  ...codexToolCompletionEventTypes,
]);

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
  callId ? truncateAtCodePointBoundary(callId, 12) : callId;

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

const codexModelOutputRole = (
  role: string | undefined,
): AgentModelOutputEvidence["role"] | undefined => {
  if (role === "developer" || role === "system") {
    return "system";
  }
  if (role === "user" || role === "assistant") {
    return role;
  }
  return undefined;
};

const codexResponseItemType = (payload: Record<string, unknown>) =>
  getString(payload, "type") ?? "response_item";

const isObjectOutput = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) && !Array.isArray(value);

const parseObjectOutput = (output: unknown): Record<string, unknown> | undefined => {
  if (isObjectOutput(output)) {
    return output;
  }
  if (typeof output !== "string") {
    return undefined;
  }

  try {
    const parsed = JSON.parse(output) as unknown;
    return isObjectOutput(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const isNonZeroExitCode = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value !== 0;

const isFailedStructuredToolOutput = (output: Record<string, unknown>) => {
  if (output.isError === true || output.success === false || isNonZeroExitCode(output.exit_code)) {
    return true;
  }

  return isObjectOutput(output.metadata) && isNonZeroExitCode(output.metadata.exit_code);
};

const isFailedCodexToolOutput = (payload: Record<string, unknown>) => {
  if (payload.status === "failed") {
    return true;
  }

  const output = parseObjectOutput(payload.output);
  return output ? isFailedStructuredToolOutput(output) : false;
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
    return {
      type: "tool_use",
      // The raw argument string is what the preview shows, so it is never
      // parsed: a large tool payload would cost a full parse and stay resident
      // for a value no consumer reads.
      text: truncateBlockText(argsSource ?? "{}"),
      toolName,
      ...(callId ? { toolCallId: callId } : {}),
    };
  }

  if (itemType === "function_call_output" || itemType === "custom_tool_call_output") {
    const text = formatAgentBlockValue(payload.output);
    const callId = getString(payload, "call_id");
    const status = isFailedCodexToolOutput(payload) ? "failed" : "completed";
    if (!text && status !== "failed") {
      return undefined;
    }
    return {
      type: "tool_result",
      text,
      ...(callId ? { toolCallId: callId } : {}),
      status,
    };
  }

  return undefined;
};

interface CodexResponseEvidenceContext {
  payload: Record<string, unknown>;
  itemType: string;
  messageRole?: string;
  turnId?: string;
  conversationItemId: string;
  block?: AgentContentBlock;
}

const withTurnId = (turnId: string | undefined) => (turnId ? { turnId } : {});

const codexTokenCount = (usage: Record<string, unknown>, key: string) => {
  const count = readTokenCount(usage, key);
  return count !== undefined && Number.isSafeInteger(count) && count >= 0 ? count : undefined;
};

const codexTokenUsage = (usage: Record<string, unknown>) => {
  const inputTokens = codexTokenCount(usage, "input_tokens");
  const outputTokens = codexTokenCount(usage, "output_tokens");
  const cacheReadInputTokens = codexTokenCount(usage, "cached_input_tokens");
  const cacheCreationInputTokens = codexTokenCount(usage, "cache_write_input_tokens");
  const reasoningOutputTokens = codexTokenCount(usage, "reasoning_output_tokens");
  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    cacheReadInputTokens === undefined &&
    cacheCreationInputTokens === undefined &&
    reasoningOutputTokens === undefined
  ) {
    return undefined;
  }

  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(cacheReadInputTokens === undefined ? {} : { cacheReadInputTokens }),
    ...(cacheCreationInputTokens === undefined ? {} : { cacheCreationInputTokens }),
    ...(reasoningOutputTokens === undefined ? {} : { reasoningOutputTokens }),
  };
};

const codexTokenUsageEvidence = (
  payload: Record<string, unknown>,
  turnId: string | undefined,
): AgentTrajectoryEvidence | undefined => {
  const info = isObjectOutput(payload.info) ? payload.info : undefined;
  const lastTokenUsage =
    info && isObjectOutput(info.last_token_usage) ? info.last_token_usage : undefined;
  const totalTokenUsage =
    info && isObjectOutput(info.total_token_usage) ? info.total_token_usage : undefined;
  const nestedUsage = lastTokenUsage ? codexTokenUsage(lastTokenUsage) : undefined;
  const cumulativeUsage = totalTokenUsage ? codexTokenUsage(totalTokenUsage) : undefined;
  const usage =
    nestedUsage ??
    (nestedUsage === undefined && cumulativeUsage === undefined
      ? codexTokenUsage(payload)
      : undefined);
  if (usage) {
    return {
      kind: "token-usage",
      ...withTurnId(turnId),
      usage,
      ...(cumulativeUsage === undefined ? {} : { cumulativeUsage }),
    };
  }
  if (!cumulativeUsage) {
    return undefined;
  }

  return {
    kind: "token-usage",
    ...withTurnId(turnId),
    cumulativeUsage,
  };
};

const hasOwn = (record: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(record, key);

const ownValue = (record: Record<string, unknown>, key: string) =>
  hasOwn(record, key) ? record[key] : undefined;

const ownString = (record: Record<string, unknown>, key: string) => {
  const value = ownValue(record, key);
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const codexCompletionDurationMs = (payload: Record<string, unknown>) => {
  const duration = ownValue(payload, "duration");
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration < 0) {
    return undefined;
  }

  const durationMs = Math.round(duration * 1000);
  return Number.isSafeInteger(durationMs) && durationMs >= 0 ? durationMs : undefined;
};

const codexToolCompletionStatus = (eventType: string, payload: Record<string, unknown>) => {
  const success = ownValue(payload, "success");
  const status = ownValue(payload, "status");
  const result = ownValue(payload, "result");
  const resultRecord = isObjectOutput(result) ? result : undefined;
  const hasResultError = resultRecord ? hasOwn(resultRecord, "Err") : false;
  const hasResultOk = resultRecord ? hasOwn(resultRecord, "Ok") : false;
  const okResult = resultRecord ? ownValue(resultRecord, "Ok") : undefined;
  const failedOkResult = isObjectOutput(okResult) && ownValue(okResult, "isError") === true;
  const failedStatus = status === "failed" || status === "error" || status === "declined";

  if (success === false || failedStatus || hasResultError || failedOkResult) {
    return "failed" as const;
  }
  if (
    success === true ||
    status === "completed" ||
    status === "success" ||
    hasResultOk ||
    eventType === "web_search_end"
  ) {
    return "completed" as const;
  }
  return undefined;
};

const codexToolCompletionEvidence = (
  eventType: string,
  payload: Record<string, unknown>,
  turnId: string | undefined,
): AgentTrajectoryEvidence | undefined => {
  const callId = ownString(payload, "call_id");
  if (!callId) {
    return undefined;
  }

  const status = codexToolCompletionStatus(eventType, payload);
  const durationMs = codexCompletionDurationMs(payload);
  return {
    kind: "tool-lifecycle",
    phase: "completion",
    ...withTurnId(turnId),
    ...(status === undefined ? {} : { status }),
    callId,
    ...(durationMs === undefined ? {} : { durationMs }),
  };
};

const codexEventEvidence = (
  eventType: string | undefined,
  payload: Record<string, unknown>,
  turnId: string | undefined,
): AgentTrajectoryEvidence | undefined => {
  if (eventType === "task_started") {
    return { kind: "turn-lifecycle", phase: "start", ...withTurnId(turnId) };
  }
  if (eventType === "task_complete") {
    return { kind: "turn-lifecycle", phase: "complete", ...withTurnId(turnId) };
  }
  if (eventType === "turn_aborted") {
    return { kind: "turn-lifecycle", phase: "aborted", ...withTurnId(turnId) };
  }
  if (eventType === "token_count") {
    return codexTokenUsageEvidence(payload, turnId);
  }
  if (eventType === "sub_agent_activity" && payload.kind === "started") {
    return { kind: "subagent-activity", status: "running", ...withTurnId(turnId) };
  }
  if (eventType === "context_compacted") {
    return { kind: "compaction", ...withTurnId(turnId) };
  }
  if (eventType && codexToolCompletionEventTypes.has(eventType)) {
    return codexToolCompletionEvidence(eventType, payload, turnId);
  }
  if (eventType === "agent_message") {
    return { kind: "model-output", role: "assistant", ...withTurnId(turnId) };
  }
  return undefined;
};

const codexToolResultEvidenceStatus = (
  payload: Record<string, unknown>,
  block: AgentContentBlock | undefined,
) => {
  if (block?.type === "tool_result") {
    return block.status;
  }
  return payload.status === "completed" ? "completed" : undefined;
};

const codexResponseEvidence = ({
  payload,
  itemType,
  messageRole,
  turnId,
  conversationItemId,
  block,
}: CodexResponseEvidenceContext): AgentTrajectoryEvidence | undefined => {
  if (itemType === "message") {
    const role = codexModelOutputRole(messageRole);
    if (!role) {
      return undefined;
    }
    return {
      kind: "model-output",
      role,
      ...withTurnId(turnId),
      conversationItemId,
    };
  }

  if (itemType === "reasoning") {
    return {
      kind: "model-output",
      role: "reasoning",
      ...withTurnId(turnId),
      conversationItemId,
    };
  }

  if (itemType === "agent_message") {
    return { kind: "subagent-activity", status: "completed", ...withTurnId(turnId) };
  }

  if (itemType === "function_call" || itemType === "custom_tool_call") {
    if (block?.type !== "tool_use") {
      return undefined;
    }
    return {
      kind: "tool-lifecycle",
      phase: "call",
      toolName: block.toolName,
      ...withTurnId(turnId),
      ...(block.toolCallId ? { callId: block.toolCallId } : {}),
      conversationItemId,
    };
  }

  if (itemType === "function_call_output" || itemType === "custom_tool_call_output") {
    const callId = block?.type === "tool_result" ? block.toolCallId : getString(payload, "call_id");
    const status = codexToolResultEvidenceStatus(payload, block);
    return {
      kind: "tool-lifecycle",
      phase: "result",
      ...withTurnId(turnId),
      ...(status === undefined ? {} : { status }),
      ...(callId ? { callId } : {}),
      conversationItemId,
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
    if (
      kind === "task_started" ||
      kind === "task_complete" ||
      kind === "turn_aborted" ||
      kind === "token_count"
    ) {
      return "meta";
    }
    if (codexToolCompletionEventTypes.has(kind)) {
      return "tool";
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
    return formatAgentPreviewValue(payload.output);
  }
  return "";
};

const createCodexBuilder = (fileName?: string): AgentAdapterBuilder => {
  const events: AgentTimelineEvent[] = [];
  const turnIdToIndex = new Map<string, number>();
  let sessionId: string | undefined;
  let cwd: string | undefined;
  let version: string | undefined;
  let model: string | undefined;
  let currentTurnId: string | undefined;

  const registerTurn = (turnId: string) => {
    const existing = turnIdToIndex.get(turnId);
    if (existing !== undefined) {
      return existing;
    }
    const nextIndex = turnIdToIndex.size + 1;
    turnIdToIndex.set(turnId, nextIndex);
    return nextIndex;
  };

  // Records before the first turn boundary belong to no turn: numbering them
  // would print a turn the rollout never reported.
  const turnIndexFor = (turnId: string | undefined) => (turnId ? registerTurn(turnId) : undefined);

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
      const eventType = envelopeType === "event_msg" ? getString(payload, "type") : undefined;
      const payloadTurnId = getString(payload, "turn_id");

      if (envelopeType === "session_meta") {
        sessionId ??= getString(payload, "session_id") ?? getString(payload, "id");
        cwd ??= getString(payload, "cwd");
        version ??= getString(payload, "cli_version");
      }

      if (envelopeType === "turn_context") {
        if (payloadTurnId) {
          currentTurnId = payloadTurnId;
        }
        cwd ??= getString(payload, "cwd");
        model = getString(payload, "model") ?? model;
      }

      if (eventType === "task_started" && payloadTurnId) {
        currentTurnId = payloadTurnId;
      }

      const eventTurnId =
        eventType && codexPayloadTurnEventTypes.has(eventType)
          ? (payloadTurnId ?? currentTurnId)
          : currentTurnId;
      const turnIndex = turnIndexFor(eventTurnId);
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

      let trajectoryEvidence: AgentTrajectoryEvidence | undefined;
      if (envelopeType === "response_item" && itemType) {
        const block = codexResponseBlock(payload, itemType);
        const conversationItemId = codexResponseItemId(line.lineNumber, itemType, messageRole);
        attachConversationItem(event, {
          id: conversationItemId,
          role: codexResponseRole(itemType, messageRole),
          ...(turnIndex === undefined ? {} : { turnIndex }),
          ...(block ? { block } : {}),
        });
        trajectoryEvidence = codexResponseEvidence({
          payload,
          itemType,
          ...(messageRole === undefined ? {} : { messageRole }),
          ...(currentTurnId === undefined ? {} : { turnId: currentTurnId }),
          conversationItemId,
          ...(block === undefined ? {} : { block }),
        });
      } else if (envelopeType === "event_msg") {
        trajectoryEvidence = codexEventEvidence(eventType, payload, eventTurnId);
      } else if (envelopeType === "compacted") {
        trajectoryEvidence = { kind: "compaction", ...withTurnId(eventTurnId) };
      }

      if (trajectoryEvidence) {
        event.trajectoryEvidence = [trajectoryEvidence];
      }

      events.push(event);
    },
    finish(parseWarnings) {
      const turnCount =
        turnIdToIndex.size > 0
          ? turnIdToIndex.size
          : events.some((event) => event.conversationItems.length > 0)
            ? 1
            : 0;
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
        },
        parseWarnings,
      );
    },
  };
};

export const codexRolloutAdapter: AgentSessionAdapter = {
  fileType: "Codex",
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
