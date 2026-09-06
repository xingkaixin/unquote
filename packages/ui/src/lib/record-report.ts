import { hasJsonNodeChildren, stringifyJsonNodeWithLimits } from "@unquote/core";
import type { JsonNode, JsonlRecord } from "@unquote/core";
import { appendJsonPathSegment, formatJsonPath, isPathWithin, parseTreePath } from "./path-codec";
import type { PublishedSourceRevision } from "./published-source";
import { yieldToMain } from "./record-export";

export const reportBytesLimit = 8 * 1024 * 1024;
export const reportRecordLimit = 1000;
const reportNodeLimit = 50_000;

export interface RecordReport {
  markdown: string;
  jsonl: string;
  lineNumbers: number[];
  redacted: number;
}

export const selectReportRecords = (records: JsonlRecord[], selection: string) => {
  const requested = new Set<number>();
  for (const token of selection.split(",").map((part) => part.trim())) {
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(token);
    if (!match) throw new Error("invalid-lines");
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 1 ||
      end < start ||
      end - start >= reportRecordLimit
    )
      throw new RangeError("report-lines-limit");
    for (let line = start; line <= end; line++) {
      requested.add(line);
      if (requested.size > reportRecordLimit) throw new RangeError("report-lines-limit");
    }
  }
  const selected = records.filter((record) => requested.has(record.lineNumber));
  if (selected.length !== requested.size) throw new Error("missing-lines");
  return selected;
};

export const parseRedactedPaths = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const segments = parseTreePath(line);
      if (!segments) throw new Error("invalid-path");
      return formatJsonPath(segments);
    });

export const redactReportNode = async (
  root: JsonNode,
  paths: readonly string[],
  signal: AbortSignal,
) => {
  let redacted = 0;
  let visits = 0;
  const clone = (node: JsonNode, path: string): JsonNode => {
    if (++visits > reportNodeLimit) throw new RangeError("report-node-limit");
    if (paths.some((target) => path === target)) {
      redacted++;
      return { kind: "string", value: "[REDACTED]" };
    }
    if (
      node.preview ||
      node.truncated ||
      (node.kind === "string" &&
        (node.stringifiedPreview ||
          (node.valueLength !== undefined && node.valueLength > node.value.length)))
    )
      throw new RangeError("report-incomplete");
    if (node.kind === "object")
      return { kind: "object", children: Object.create(null) as Record<string, JsonNode> };
    if (node.kind === "array") return { kind: "array", children: [] };
    const copy = { ...node };
    delete copy.rawString;
    return copy;
  };
  const output = clone(root, "$");
  const pending = [{ input: root, output, path: "$" }];
  while (pending.length) {
    signal.throwIfAborted();
    const current = pending.pop()!;
    if (!hasJsonNodeChildren(current.input) || !hasJsonNodeChildren(current.output)) continue;
    for (const key of Object.keys(current.input.children)) {
      const child = (current.input.children as Record<string, JsonNode>)[key]!;
      const path = appendJsonPathSegment(current.path, {
        kind: current.input.kind === "array" ? "index" : "key",
        value: key,
      });
      const copied = clone(child, path);
      (current.output.children as Record<string, JsonNode>)[key] = copied;
      pending.push({ input: child, output: copied, path });
      if (visits % 250 === 0) {
        await yieldToMain();
        signal.throwIfAborted();
      }
    }
  }
  return { node: output, redacted };
};

const fenced = (text: string, language: string) => {
  let length = 3;
  for (const match of text.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1);
  const fence = "`".repeat(length);
  return `${fence}${language}\n${text}\n${fence}`;
};

export const buildRecordReport = async (
  source: PublishedSourceRevision,
  records: JsonlRecord[],
  selection: string,
  redactions: string,
  notes: string,
  signal: AbortSignal,
): Promise<RecordReport> => {
  signal.throwIfAborted();
  const selected = selectReportRecords(records, selection);
  const paths = parseRedactedPaths(redactions).filter(
    (path, index, all) =>
      !all.some((other, i) => i !== index && other !== path && isPathWithin(path, other)),
  );
  const previews = selected.filter((record) => record.status === "preview");
  const full =
    previews.length && source.kind === "local-file"
      ? await source.access.resolveRecords(previews, signal, reportBytesLimit)
      : [];
  signal.throwIfAborted();
  const resolved = new Map(full.map((record) => [record.id, record]));
  const encoder = new TextEncoder();
  let bytes = encoder.encode(notes).byteLength;
  if (bytes > reportBytesLimit) throw new RangeError("report-limit");
  const bodies: string[] = [];
  const sections: string[] = [];
  let redacted = 0;
  for (const candidate of selected) {
    signal.throwIfAborted();
    const record = resolved.get(candidate.id) ?? candidate;
    if (record.status !== "full") throw new Error("invalid-record");
    const sanitized = await redactReportNode(record.node, paths, signal);
    const body = stringifyJsonNodeWithLimits(sanitized.node, {
      maxBytes: reportBytesLimit - bytes,
      maxNodes: reportNodeLimit,
    });
    if (!body.complete) throw new RangeError("report-limit");
    bytes += encoder.encode(body.text).byteLength;
    redacted += sanitized.redacted;
    bodies.push(body.text);
    sections.push(`## Line ${record.lineNumber}\n\n${fenced(body.text, "json")}`);
    await yieldToMain();
  }
  signal.throwIfAborted();
  return {
    markdown: `# Unquote report\n\n${notes ? `## Notes\n\n${fenced(notes, "text")}\n\n` : ""}${sections.join("\n\n")}\n`,
    jsonl: bodies.join("\n") + "\n",
    lineNumbers: selected.map((record) => record.lineNumber),
    redacted,
  };
};
