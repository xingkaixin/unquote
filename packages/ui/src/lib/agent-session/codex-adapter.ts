import { truncateAtCodePointBoundary } from "@unquote/core";
import type { AgentAdapterBuilder, AgentSessionAdapter } from "./adapter-types";
import type {
  AgentContentBlock,
  AgentConversationRole,
  AgentEventCategory,
  AgentModelOutputEvidence,
  AgentTimelineEvent,
  AgentSessionEvidence,
} from "./session-types";
import {
  formatAgentBlockValue,
  formatAgentPreviewValue,
  truncateBlockText,
  truncatePreview,
} from "./agent-value-format";
import {
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

interface NormalizedCodexMessageRole {
  conversationRole: AgentConversationRole;
  category: AgentEventCategory;
  evidenceRole: AgentModelOutputEvidence["role"] | undefined;
}

const normalizeCodexMessageRole = (role: string | undefined): NormalizedCodexMessageRole => {
  if (role === "developer" || role === "system") {
    return { conversationRole: "system", category: "system", evidenceRole: "system" };
  }
  if (role === "user") {
    return { conversationRole: "user", category: "user", evidenceRole: "user" };
  }
  if (role === "assistant") {
    return { conversationRole: "assistant", category: "assistant", evidenceRole: "assistant" };
  }
  return { conversationRole: "system", category: "unknown", evidenceRole: undefined };
};

const codexResponseItemType = (payload: Record<string, unknown>) =>
  getString(payload, "type") ?? "response_item";

type NormalizedCodexResponseItem =
  | {
      type: "message";
      itemType: "message";
      messageRole: string | undefined;
      conversationRole: AgentConversationRole;
      category: AgentEventCategory;
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

const parseObjectOutput = (output: unknown): Record<string, unknown> | undefined => {
  if (isRecord(output)) {
    return output;
  }
  if (typeof output !== "string") {
    return undefined;
  }

  try {
    const parsed = JSON.parse(output) as unknown;
    return isRecord(parsed) ? parsed : undefined;
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

  return isRecord(output.metadata) && isNonZeroExitCode(output.metadata.exit_code);
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
    const normalizedRole = normalizeCodexMessageRole(messageRole);
    return {
      type: "message",
      itemType,
      messageRole,
      ...normalizedRole,
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
): AgentSessionEvidence | undefined => {
  const info = isRecord(payload.info) ? payload.info : undefined;
  const lastTokenUsage =
    info && isRecord(info.last_token_usage) ? info.last_token_usage : undefined;
  const totalTokenUsage =
    info && isRecord(info.total_token_usage) ? info.total_token_usage : undefined;
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
  if (!isRecord(duration)) {
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
  const resultRecord = isRecord(result) ? result : undefined;
  const hasResultError = resultRecord ? hasOwn(resultRecord, "Err") : false;
  const hasResultOk = resultRecord ? hasOwn(resultRecord, "Ok") : false;
  const okResult = resultRecord ? ownValue(resultRecord, "Ok") : undefined;
  const failedOkResult = isRecord(okResult) && ownValue(okResult, "isError") === true;
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
): AgentSessionEvidence | undefined => {
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

type CodexEvidenceProjector = (
  payload: Record<string, unknown>,
  turnId: string | undefined,
) => AgentSessionEvidence | undefined;

interface CodexEventRule {
  category: AgentEventCategory;
  turnIdSource: "current" | "payload";
  startsTurn?: true;
  projectEvidence?: CodexEvidenceProjector;
}

const codexToolCompletionRule = (eventType: string): CodexEventRule => ({
  category: "tool",
  turnIdSource: "payload",
  projectEvidence: (payload, turnId) => codexToolCompletionEvidence(eventType, payload, turnId),
});

const codexEventRules = {
  user_message: { category: "user", turnIdSource: "current" },
  agent_message: {
    category: "assistant",
    turnIdSource: "current",
    projectEvidence: (_payload, turnId) => ({
      kind: "model-output",
      role: "assistant",
      ...withTurnId(turnId),
    }),
  },
  task_started: {
    category: "meta",
    turnIdSource: "payload",
    startsTurn: true,
    projectEvidence: (_payload, turnId) => ({
      kind: "turn-lifecycle",
      phase: "start",
      ...withTurnId(turnId),
    }),
  },
  task_complete: {
    category: "meta",
    turnIdSource: "payload",
    projectEvidence: (_payload, turnId) => ({
      kind: "turn-lifecycle",
      phase: "complete",
      ...withTurnId(turnId),
    }),
  },
  turn_aborted: {
    category: "meta",
    turnIdSource: "payload",
    projectEvidence: (_payload, turnId) => ({
      kind: "turn-lifecycle",
      phase: "aborted",
      ...withTurnId(turnId),
    }),
  },
  token_count: {
    category: "meta",
    turnIdSource: "payload",
    projectEvidence: codexTokenUsageEvidence,
  },
  sub_agent_activity: {
    category: "unknown",
    turnIdSource: "payload",
    projectEvidence: (payload, turnId) =>
      payload.kind === "started"
        ? { kind: "subagent-activity", status: "running", ...withTurnId(turnId) }
        : undefined,
  },
  context_compacted: {
    category: "unknown",
    turnIdSource: "current",
    projectEvidence: (_payload, turnId) => ({
      kind: "compaction",
      ...withTurnId(turnId),
    }),
  },
  exec_command_end: codexToolCompletionRule("exec_command_end"),
  mcp_tool_call_end: codexToolCompletionRule("mcp_tool_call_end"),
  patch_apply_end: codexToolCompletionRule("patch_apply_end"),
  web_search_end: codexToolCompletionRule("web_search_end"),
} satisfies Record<string, CodexEventRule>;

const codexEventRuleFor = (eventType: string | undefined): CodexEventRule | undefined => {
  if (!eventType || !hasOwn(codexEventRules, eventType)) {
    return undefined;
  }
  return codexEventRules[eventType as keyof typeof codexEventRules];
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
  sessionEvidence?: AgentSessionEvidence;
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
      const sessionEvidence = item.evidenceRole
        ? ({
            kind: "model-output",
            role: item.evidenceRole,
            ...withTurnId(turnId),
            conversationItemId,
          } satisfies AgentSessionEvidence)
        : undefined;
      return {
        category: item.category,
        kind: item.itemType,
        label: item.messageRole ?? item.itemType,
        preview: truncatePreview(item.text),
        conversation: {
          id: conversationItemId,
          role: item.conversationRole,
          ...(block === undefined ? {} : { block }),
        },
        ...(sessionEvidence === undefined ? {} : { sessionEvidence }),
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
        sessionEvidence: {
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
        sessionEvidence: {
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
      } satisfies AgentContentBlock;
      return {
        category: "tool",
        kind: item.itemType,
        label: `tool_use ${item.toolName}`,
        preview: truncatePreview(item.text ?? ""),
        conversation: { id: conversationItemId, role: "tool_call", block },
        sessionEvidence: {
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
        sessionEvidence: {
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

interface CodexEventProjectionContext {
  lineNumber: number;
  sessionId: string | undefined;
  cwd: string | undefined;
  turnId: string | undefined;
  eventType: string | undefined;
  eventRule: CodexEventRule | undefined;
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
    const sessionEvidence = context.eventRule?.projectEvidence?.(payload, context.turnId);
    return {
      category: context.eventRule?.category ?? "unknown",
      kind,
      label: kind,
      preview: truncatePreview(
        getString(payload, "message") ?? getString(payload, "turn_id") ?? "",
      ),
      ...(sessionEvidence === undefined ? {} : { sessionEvidence }),
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
      ? { sessionEvidence: { kind: "compaction", ...withTurnId(context.turnId) } }
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
      const eventRule = codexEventRuleFor(eventType);
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

      if (eventRule?.startsTurn && payloadTurnId) {
        currentTurnId = payloadTurnId;
      }

      const eventTurnId =
        eventRule?.turnIdSource === "payload" ? (payloadTurnId ?? currentTurnId) : currentTurnId;
      const turnIndex = turnIndexFor(eventTurnId);
      const projection = projectCodexEvent(envelopeType, payload, {
        lineNumber: line.lineNumber,
        sessionId,
        cwd,
        turnId: eventTurnId,
        eventType,
        eventRule,
      });
      const event = createBaseEvent(
        line,
        projection.category,
        projection.kind,
        projection.label,
        projection.preview,
        {
          timestamp: parseTimestamp(envelope.timestamp),
          timestampLabel: getString(envelope, "timestamp"),
          turnIndex,
        },
      );

      if (projection.conversation) {
        attachConversationItem(event, {
          id: projection.conversation.id,
          role: projection.conversation.role,
          ...(turnIndex === undefined ? {} : { turnIndex }),
          ...(projection.conversation.block ? { block: projection.conversation.block } : {}),
        });
      }

      if (projection.sessionEvidence) {
        event.sessionEvidence = [projection.sessionEvidence];
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
