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
  "exec_command_end",
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

type NormalizedCodexResponseItem =
  | {
      type: "message";
      itemType: "message";
      messageRole: string | undefined;
      conversationRole: AgentConversationRole;
      evidenceRole: AgentModelOutputEvidence["role"] | undefined;
      text: string;
    }
  | { type: "reasoning"; itemType: "reasoning"; text: string }
  | { type: "agent-message"; itemType: "agent_message" }
  | {
      type: "tool-call";
      itemType: "function_call" | "custom_tool_call";
      toolName: string;
      callId: string | undefined;
      text: string | undefined;
    }
  | {
      type: "tool-result";
      itemType: "function_call_output" | "custom_tool_call_output";
      callId: string | undefined;
      text: string;
      preview: string;
      status: "completed" | "failed";
      evidenceStatus: "completed" | "failed" | undefined;
    }
  | { type: "unknown"; itemType: string };

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

const normalizeCodexResponseItem = (
  payload: Record<string, unknown>,
): NormalizedCodexResponseItem => {
  const itemType = codexResponseItemType(payload);
  if (itemType === "message") {
    const messageRole = getString(payload, "role");
    return {
      type: "message",
      itemType,
      messageRole,
      conversationRole: codexMessageRole(messageRole),
      evidenceRole: codexModelOutputRole(messageRole),
      text: extractCodexMessageText(payload.content),
    };
  }

  if (itemType === "reasoning") {
    return { type: "reasoning", itemType, text: extractCodexReasoningText(payload) };
  }

  if (itemType === "agent_message") {
    return { type: "agent-message", itemType };
  }

  if (itemType === "function_call" || itemType === "custom_tool_call") {
    const toolName = getString(payload, "name") ?? "tool";
    const callId = getString(payload, "call_id");
    // Keep the raw argument string: parsing a large payload would retain a value
    // that no consumer needs beyond its bounded preview.
    const text =
      itemType === "function_call" ? getString(payload, "arguments") : getString(payload, "input");
    return {
      type: "tool-call",
      itemType,
      toolName,
      callId,
      text,
    };
  }

  if (itemType === "function_call_output" || itemType === "custom_tool_call_output") {
    const text = formatAgentBlockValue(payload.output);
    const callId = getString(payload, "call_id");
    const status = isFailedCodexToolOutput(payload) ? "failed" : "completed";
    return {
      type: "tool-result",
      itemType,
      callId,
      text,
      preview: formatAgentPreviewValue(payload.output),
      status,
      evidenceStatus:
        status === "failed" || text || payload.status === "completed" ? status : undefined,
    };
  }

  return { type: "unknown", itemType };
};

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

const codexDurationSeconds = (duration: unknown) => {
  if (typeof duration === "number") {
    return Number.isFinite(duration) && duration >= 0 ? duration : undefined;
  }
  if (!isObjectOutput(duration)) {
    return undefined;
  }

  const secs = ownValue(duration, "secs");
  if (typeof secs !== "number" || !Number.isFinite(secs) || secs < 0) {
    return undefined;
  }
  const nanos = ownValue(duration, "nanos");
  const nanoSeconds =
    typeof nanos === "number" && Number.isFinite(nanos) && nanos >= 0 ? nanos / 1e9 : 0;
  return secs + nanoSeconds;
};

const codexCompletionDurationMs = (payload: Record<string, unknown>) => {
  const duration = codexDurationSeconds(ownValue(payload, "duration"));
  if (duration === undefined) {
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
  const exitCode = ownValue(payload, "exit_code");

  if (success === false || failedStatus || hasResultError || failedOkResult) {
    return "failed" as const;
  }
  if (isNonZeroExitCode(exitCode)) {
    return "failed" as const;
  }
  if (
    success === true ||
    status === "completed" ||
    status === "success" ||
    hasResultOk ||
    exitCode === 0 ||
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

interface CodexConversationProjection {
  id: string;
  role: AgentConversationRole;
  block?: AgentContentBlock;
}

interface CodexEventProjection {
  category: AgentEventCategory;
  kind: string;
  label: string;
  preview: string;
  conversation?: CodexConversationProjection;
  trajectoryEvidence?: AgentTrajectoryEvidence;
}

const projectCodexResponseItem = (
  item: NormalizedCodexResponseItem,
  lineNumber: number,
  turnId: string | undefined,
): CodexEventProjection => {
  switch (item.type) {
    case "message": {
      const conversationItemId = `conv-${lineNumber}-${item.conversationRole}`;
      const block = item.text
        ? ({ type: "text", text: truncateBlockText(item.text) } satisfies AgentContentBlock)
        : undefined;
      const trajectoryEvidence = item.evidenceRole
        ? ({
            kind: "model-output",
            role: item.evidenceRole,
            ...withTurnId(turnId),
            conversationItemId,
          } satisfies AgentTrajectoryEvidence)
        : undefined;
      return {
        category: codexMessageCategory(item.messageRole),
        kind: item.itemType,
        label: item.messageRole ?? item.itemType,
        preview: truncatePreview(item.text),
        conversation: {
          id: conversationItemId,
          role: item.conversationRole,
          ...(block === undefined ? {} : { block }),
        },
        ...(trajectoryEvidence === undefined ? {} : { trajectoryEvidence }),
      };
    }
    case "reasoning": {
      const conversationItemId = `conv-${lineNumber}-thinking`;
      return {
        category: "thinking",
        kind: item.itemType,
        label: item.itemType,
        preview: truncatePreview(item.text),
        conversation: {
          id: conversationItemId,
          role: "thinking",
          block: { type: "thinking", text: truncateBlockText(item.text) },
        },
        trajectoryEvidence: {
          kind: "model-output",
          role: "reasoning",
          ...withTurnId(turnId),
          conversationItemId,
        },
      };
    }
    case "agent-message":
      return {
        category: "unknown",
        kind: item.itemType,
        label: item.itemType,
        preview: "",
        conversation: {
          id: `conv-${lineNumber}-response-item`,
          role: "system",
        },
        trajectoryEvidence: {
          kind: "subagent-activity",
          status: "completed",
          ...withTurnId(turnId),
        },
      };
    case "tool-call": {
      const conversationItemId = `conv-${lineNumber}-tool-call`;
      const block = {
        type: "tool_use",
        text: truncateBlockText(item.text ?? "{}"),
        toolName: item.toolName,
        ...(item.callId ? { toolCallId: item.callId } : {}),
      } satisfies AgentContentBlock;
      return {
        category: "tool",
        kind: item.itemType,
        label: `tool_use ${item.toolName}`,
        preview: truncatePreview(item.text ?? ""),
        conversation: { id: conversationItemId, role: "tool_call", block },
        trajectoryEvidence: {
          kind: "tool-lifecycle",
          phase: "call",
          toolName: item.toolName,
          ...withTurnId(turnId),
          ...(item.callId ? { callId: item.callId } : {}),
          conversationItemId,
        },
      };
    }
    case "tool-result": {
      const conversationItemId = `conv-${lineNumber}-tool-result`;
      const block =
        item.text || item.status === "failed"
          ? ({
              type: "tool_result",
              text: item.text,
              ...(item.callId ? { toolCallId: item.callId } : {}),
              status: item.status,
            } satisfies AgentContentBlock)
          : undefined;
      return {
        category: "tool",
        kind: item.itemType,
        label: `tool_result ${shortCallId(item.callId) ?? "unknown"}`,
        preview: item.preview,
        conversation: {
          id: conversationItemId,
          role: "tool_result",
          ...(block === undefined ? {} : { block }),
        },
        trajectoryEvidence: {
          kind: "tool-lifecycle",
          phase: "result",
          ...withTurnId(turnId),
          ...(item.evidenceStatus === undefined ? {} : { status: item.evidenceStatus }),
          ...(item.callId ? { callId: item.callId } : {}),
          conversationItemId,
        },
      };
    }
    case "unknown":
      return {
        category: "unknown",
        kind: item.itemType,
        label: item.itemType,
        preview: "",
        conversation: {
          id: `conv-${lineNumber}-response-item`,
          role: "system",
        },
      };
  }
};

const codexEventCategory = (eventType: string): AgentEventCategory => {
  if (eventType === "user_message") {
    return "user";
  }
  if (eventType === "agent_message") {
    return "assistant";
  }
  if (
    eventType === "task_started" ||
    eventType === "task_complete" ||
    eventType === "turn_aborted" ||
    eventType === "token_count"
  ) {
    return "meta";
  }
  return codexToolCompletionEventTypes.has(eventType) ? "tool" : "unknown";
};

interface CodexEventProjectionContext {
  lineNumber: number;
  sessionId: string | undefined;
  cwd: string | undefined;
  turnId: string | undefined;
  eventType: string | undefined;
}

const projectCodexEvent = (
  envelopeType: string,
  payload: Record<string, unknown>,
  context: CodexEventProjectionContext,
): CodexEventProjection => {
  if (envelopeType === "response_item") {
    return projectCodexResponseItem(
      normalizeCodexResponseItem(payload),
      context.lineNumber,
      context.turnId,
    );
  }
  if (envelopeType === "event_msg") {
    const kind = context.eventType ?? "event_msg";
    const trajectoryEvidence = codexEventEvidence(context.eventType, payload, context.turnId);
    return {
      category: codexEventCategory(kind),
      kind,
      label: kind,
      preview: truncatePreview(
        getString(payload, "message") ?? getString(payload, "turn_id") ?? "",
      ),
      ...(trajectoryEvidence === undefined ? {} : { trajectoryEvidence }),
    };
  }
  if (envelopeType === "session_meta") {
    return {
      category: "meta",
      kind: envelopeType,
      label: envelopeType,
      preview: truncatePreview(context.sessionId ?? context.cwd ?? ""),
    };
  }
  if (envelopeType === "turn_context") {
    return {
      category: "meta",
      kind: envelopeType,
      label: envelopeType,
      preview: truncatePreview(
        [getString(payload, "model"), getString(payload, "cwd")].filter(Boolean).join(" - "),
      ),
    };
  }
  return {
    category: "unknown",
    kind: envelopeType,
    label: envelopeType,
    preview: "",
    ...(envelopeType === "compacted"
      ? { trajectoryEvidence: { kind: "compaction", ...withTurnId(context.turnId) } }
      : {}),
  };
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
      const projection = projectCodexEvent(envelopeType, payload, {
        lineNumber: line.lineNumber,
        sessionId,
        cwd,
        turnId: eventTurnId,
        eventType,
      });
      const event = createBaseEvent(
        line,
        projection.category,
        projection.kind,
        projection.label,
        projection.preview,
      );
      addOptionalNumber(event, "timestamp", parseTimestamp(envelope.timestamp));
      addOptionalNumber(event, "turnIndex", turnIndex);
      addOptionalString(event, "timestampLabel", getString(envelope, "timestamp"));

      if (projection.conversation) {
        attachConversationItem(event, {
          id: projection.conversation.id,
          role: projection.conversation.role,
          ...(turnIndex === undefined ? {} : { turnIndex }),
          ...(projection.conversation.block ? { block: projection.conversation.block } : {}),
        });
      }

      if (projection.trajectoryEvidence) {
        event.trajectoryEvidence = [projection.trajectoryEvidence];
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
      if (sample.type && codexEnvelopeTypes.has(sample.type) && sample.hasObjectPayload) {
        hits += 1;
      }
    }

    return hits / samples.length;
  },
  createBuilder: createCodexBuilder,
};
