import { truncateAtCodePointBoundary } from "@unquote/core";
import type {
  AgentAdapterBuilder,
  AgentContentBlock,
  AgentConversationRole,
  AgentEventCategory,
  AgentSessionAdapter,
  AgentTimelineEvent,
} from "./types";
import {
  addOptionalNumber,
  addOptionalString,
  attachConversationItem,
  buildSession,
  createBaseEvent,
  getString,
  isRecord,
  parseTimestamp,
  stringifyValue,
  truncateBlockText,
  truncatePreview,
} from "./shared";

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
    const text = truncateBlockText(stringifyValue(payload.output));
    const callId = getString(payload, "call_id");
    if (!text) {
      return undefined;
    }
    return {
      type: "tool_result",
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
  const currentTurnIndex = () => (currentTurnId ? registerTurn(currentTurnId) : undefined);

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
        attachConversationItem(event, {
          id: codexResponseItemId(line.lineNumber, itemType, messageRole),
          role: codexResponseRole(itemType, messageRole),
          ...(turnIndex === undefined ? {} : { turnIndex }),
          ...(block ? { block } : {}),
        });
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
