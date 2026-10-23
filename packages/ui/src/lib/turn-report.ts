import { hasJsonNodeChildren, stringifyJsonNodeWithLimits } from "@unquote/core";
import type { JsonNode, JsonlRecord } from "@unquote/core";
import type { AgentConversationEntry, AgentSession, AgentSessionModel } from "./agent-session";
import { appendJsonPathSegment, parseTreePath } from "./path-codec";
import type { PublishedSourceRevision } from "./published-source";
import {
  fenced,
  redactReportNode,
  reportBytesLimit,
  reportNodeLimit,
  reportRecordLimit,
  reportRedactionPaths,
  streamReportRecords,
} from "./record-report";

export interface TurnReport {
  markdown: string;
  lineNumbers: number[];
  redacted: number;
}

export interface TurnReportOptions {
  redactions: string;
  notes: string;
  includeReasoning: boolean;
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const appendTo = <Key, Value>(map: Map<Key, Value[]>, key: Key, value: Value) => {
  const values = map.get(key);
  if (values) values.push(value);
  else map.set(key, [value]);
};

const resolveContentNode = (root: JsonNode, path: string, redactedPaths: readonly string[]) => {
  const segments = parseTreePath(path);
  if (!segments) throw new Error("invalid-record");
  let node = root;
  let current = "$";
  for (const segment of segments) {
    if (redactedPaths.includes(current)) return node;
    if (!hasJsonNodeChildren(node) || (node.kind === "array") !== (segment.kind === "index"))
      throw new Error("invalid-record");
    // SAFETY: The container kind matches the segment kind, so the key addresses a canonical child entry.
    const child = (node.children as Record<string, JsonNode | undefined>)[segment.value];
    if (!child) throw new Error("invalid-record");
    node = child;
    current = appendJsonPathSegment(current, segment);
  }
  return node;
};

const partTitle = (entry: AgentConversationEntry, model: AgentSessionModel) => {
  const { item, event } = entry;
  const line = `Line ${event.lineNumber}`;
  if (item.role !== "tool_call" && item.role !== "tool_result") {
    const role = {
      user: "User",
      assistant: "Assistant",
      system: "System",
      thinking: "Reasoning",
    }[item.role];
    return `${line} · ${role}`;
  }
  const tool = model.resolveToolName(item) ?? "unknown tool";
  const status = model.resolveToolStatus(item);
  const lines = model.resolveToolLines(item);
  const pair =
    item.role === "tool_call"
      ? lines.result === undefined
        ? "no paired result"
        : `result: line ${lines.result}`
      : lines.call === undefined
        ? "no paired call"
        : `call: line ${lines.call}`;
  const role = item.role === "tool_call" ? "Tool call" : "Tool result";
  return `${line} · ${role} · ${tool} · ${status} · ${pair}`;
};

export const buildTurnReport = async (
  source: PublishedSourceRevision,
  records: readonly JsonlRecord[],
  format: AgentSession["fileType"],
  model: AgentSessionModel,
  turns: readonly number[],
  options: TurnReportOptions,
  signal: AbortSignal,
): Promise<TurnReport> => {
  signal.throwIfAborted();
  const requested = new Set(turns);
  const found = new Set<number>();
  const entriesByTurn = new Map<number, AgentConversationEntry[]>();
  const entriesByLine = new Map<number, AgentConversationEntry[]>();
  const recordIdByLine = new Map<number, string>();
  for (const entry of model.conversation) {
    const turn = entry.event.turnIndex;
    if (turn === undefined || !requested.has(turn)) continue;
    found.add(turn);
    if (!entry.item.block || (entry.item.role === "thinking" && !options.includeReasoning))
      continue;
    const { lineNumber, recordId } = entry.event;
    appendTo(entriesByTurn, turn, entry);
    appendTo(entriesByLine, lineNumber, entry);
    recordIdByLine.set(lineNumber, recordId);
  }
  if (requested.size === 0 || found.size !== requested.size) throw new Error("missing-turns");
  if (recordIdByLine.size > reportRecordLimit) throw new RangeError("report-lines-limit");

  const selected = records.filter((record) => recordIdByLine.has(record.lineNumber));
  if (selected.length !== recordIdByLine.size) throw new Error("missing-lines");
  if (selected.some((record) => record.id !== recordIdByLine.get(record.lineNumber)))
    throw new Error("invalid-record");

  const paths = reportRedactionPaths(options.redactions);
  const encoder = new TextEncoder();
  let bytes = encoder.encode(options.notes).byteLength;
  if (bytes > reportBytesLimit) throw new RangeError("report-limit");
  const parts = new Map<string, string>();
  let redacted = 0;

  const renderContent = (node: JsonNode) => {
    if (node.kind === "string") return fenced(node.value, "text");
    const body = stringifyJsonNodeWithLimits(
      node,
      { maxBytes: reportBytesLimit - bytes, maxNodes: reportNodeLimit },
      { indent: 2 },
    );
    if (!body.complete) throw new RangeError("report-limit");
    return fenced(body.text, "json");
  };

  await streamReportRecords(
    source,
    selected,
    async (record) => {
      const sanitized = await redactReportNode(record.node, paths, signal);
      redacted += sanitized.redacted;
      for (const entry of entriesByLine.get(record.lineNumber) ?? []) {
        const sourcePaths = entry.item.block?.sourcePaths;
        if (!sourcePaths) throw new Error("invalid-record");
        const body =
          sourcePaths.length === 0
            ? "_No readable content in the log._"
            : sourcePaths
                .map((path) => renderContent(resolveContentNode(sanitized.node, path, paths)))
                .join("\n\n");
        const title = partTitle(entry, model);
        const part =
          entry.item.role === "user" || entry.item.role === "assistant"
            ? `### ${title}\n\n${body}`
            : `<details>\n<summary>${escapeHtml(title)}</summary>\n\n${body}\n\n</details>`;
        bytes += encoder.encode(part).byteLength;
        if (bytes > reportBytesLimit) throw new RangeError("report-limit");
        parts.set(entry.item.id, part);
      }
    },
    signal,
  );

  const sections = [...requested]
    .sort((a, b) => a - b)
    .map((turn) => {
      const entries = entriesByTurn.get(turn) ?? [];
      const body = entries.length
        ? entries.map((entry) => parts.get(entry.item.id)!).join("\n\n")
        : "_No exported content in this turn._";
      return `## Turn ${turn}\n\n${body}`;
    });
  const notes = options.notes ? `## Notes\n\n${fenced(options.notes, "text")}\n\n` : "";
  return {
    markdown: `# Unquote turn report\n\nFormat: ${format}\n\n${notes}${sections.join("\n\n")}\n`,
    lineNumbers: selected.map((record) => record.lineNumber),
    redacted,
  };
};
