import type { JsonNode, JsonlRecord, LosslessJsonValue } from "@unquote/core";
import { stringifyJsonNode } from "@unquote/core";
import { isArrayElementPath } from "./path-codec";
import { copyBytesLimit } from "./record-export";
import { resolveTreePath } from "./tree-path";
import type { SelectedPath } from "./workspace-selection";

export const inspectorNodeLimit = 2000;
export const inspectorCharLimit = 20_000;

type SelectedNodeCopy = { kind: "available"; format: () => string } | { kind: "blocked" };

export type SelectedNodeProjection =
  | { kind: "empty"; copy: { kind: "blocked" } }
  | { kind: "loading"; selection: SelectedPath; copy: { kind: "blocked" } }
  | { kind: "too-large"; selection: SelectedPath; copy: { kind: "blocked" } }
  | {
      kind: "value";
      selection: SelectedPath;
      text: string;
      truncated: boolean;
      copy: SelectedNodeCopy;
    };

type SerializableValue =
  | { representation: "node"; value: JsonNode }
  | { representation: "lossless"; value: LosslessJsonValue };

interface ContainerEntry {
  key: string;
  value: SerializableValue;
}

interface ContainerCursor {
  kind: "object" | "array";
  next: () => IteratorResult<ContainerEntry>;
}

type ResolvedValue =
  | { type: "literal"; value: string }
  | { type: "string"; value: string }
  | { type: "container"; cursor: ContainerCursor };

type SerializationTask =
  | { type: "value"; source: SerializableValue; depth: number }
  | { type: "container"; cursor: ContainerCursor; index: number; depth: number };

interface SerializationResult {
  complete: boolean;
  nodeLimitExceeded: boolean;
}

type WriterGoal = "size" | "preview-and-size";

const stringChunkSize = 16_384;
const indentation = "  ";
const textEncoder = new TextEncoder();

const utf8Width = (value: string, index: number) => {
  const first = value.charCodeAt(index);
  if (first <= 0x7f) {
    return { bytes: 1, codeUnits: 1 };
  }
  if (first <= 0x7ff) {
    return { bytes: 2, codeUnits: 1 };
  }
  if (first >= 0xd800 && first <= 0xdbff) {
    const second = value.charCodeAt(index + 1);
    if (second >= 0xdc00 && second <= 0xdfff) {
      return { bytes: 4, codeUnits: 2 };
    }
  }
  return { bytes: 3, codeUnits: 1 };
};

const utf8PrefixWithin = (value: string, byteLimit: number) => {
  const encodedLength = textEncoder.encode(value).byteLength;
  if (encodedLength <= byteLimit) {
    return { bytes: encodedLength, codeUnits: value.length, complete: true };
  }

  let bytes = 0;
  let index = 0;

  while (index < value.length) {
    const width = utf8Width(value, index);
    if (bytes + width.bytes > byteLimit) {
      break;
    }
    bytes += width.bytes;
    index += width.codeUnits;
  }

  return { bytes, codeUnits: index, complete: index === value.length };
};

class BoundedWriter {
  readonly chunks: string[] = [];
  byteLength = 0;
  charLength = 0;
  byteLimitExceeded = false;
  charLimitExceeded = false;

  constructor(
    private readonly byteLimit: number,
    private readonly charLimit: number,
    private readonly capture: boolean,
    private readonly goal: WriterGoal,
  ) {}

  get remainingBytes() {
    return Math.max(0, this.byteLimit - this.byteLength);
  }

  exceedByteLimit() {
    this.byteLimitExceeded = true;
    return this.shouldContinue();
  }

  append(value: string) {
    if (value.length === 0) {
      return true;
    }

    if (this.capture) {
      const remainingChars = Math.max(0, this.charLimit - this.charLength);
      const captured = value.slice(0, remainingChars);
      if (captured.length > 0) {
        this.chunks.push(captured);
        this.charLength += captured.length;
      }
      if (captured.length < value.length) {
        this.charLimitExceeded = true;
      }
    }

    if (!this.byteLimitExceeded) {
      const remainingBytes = Math.max(0, this.byteLimit - this.byteLength);
      const prefix = utf8PrefixWithin(value, remainingBytes);
      this.byteLength += prefix.bytes;
      this.byteLimitExceeded = !prefix.complete;
    }

    return this.shouldContinue();
  }

  private shouldContinue() {
    return this.goal === "size"
      ? !this.byteLimitExceeded
      : !(this.byteLimitExceeded && this.charLimitExceeded);
  }

  text() {
    return this.chunks.join("");
  }
}

const objectCursor = <T>(
  values: Record<string, T>,
  representation: SerializableValue["representation"],
): ContainerCursor => {
  function* entries() {
    for (const key in values) {
      if (Object.hasOwn(values, key)) {
        yield {
          key,
          value: { representation, value: values[key]! } as SerializableValue,
        };
      }
    }
  }

  const iterator = entries();
  return { kind: "object", next: () => iterator.next() };
};

const arrayCursor = <T>(
  values: T[],
  representation: SerializableValue["representation"],
): ContainerCursor => {
  let index = 0;
  return {
    kind: "array",
    next: () => {
      if (index >= values.length) {
        return { done: true, value: undefined };
      }
      const current = index;
      index += 1;
      return {
        done: false,
        value: {
          key: String(current),
          value: { representation, value: values[current]! } as SerializableValue,
        },
      };
    },
  };
};

const resolveLosslessValue = (value: LosslessJsonValue): ResolvedValue => {
  if (value === null) {
    return { type: "literal", value: "null" };
  }
  if (typeof value === "string") {
    return { type: "string", value };
  }
  if (typeof value === "boolean") {
    return { type: "literal", value: String(value) };
  }
  if (value.type === "number") {
    return { type: "literal", value: value.rawValue };
  }
  if (value.type === "array") {
    return { type: "container", cursor: arrayCursor(value.items, "lossless") };
  }
  return { type: "container", cursor: objectCursor(value.entries, "lossless") };
};

const resolveNode = (node: JsonNode): ResolvedValue => {
  if (node.kind === "object") {
    if (node.children) {
      return { type: "container", cursor: objectCursor(node.children, "node") };
    }
    return node.preview ? { type: "literal", value: "null" } : resolveLosslessValue(node.value);
  }
  if (node.kind === "array") {
    if (node.children) {
      return { type: "container", cursor: arrayCursor(node.children, "node") };
    }
    return node.preview ? { type: "literal", value: "null" } : resolveLosslessValue(node.value);
  }
  if (node.kind === "string") {
    return { type: "string", value: node.value };
  }
  if (node.kind === "number") {
    return { type: "literal", value: stringifyJsonNode(node) };
  }
  return { type: "literal", value: node.value === null ? "null" : String(node.value) };
};

const resolveValue = (source: SerializableValue) =>
  source.representation === "node" ? resolveNode(source.value) : resolveLosslessValue(source.value);

const writeJsonString = (writer: BoundedWriter, value: string) => {
  if (
    !writer.byteLimitExceeded &&
    value.length + 2 > writer.remainingBytes &&
    !writer.exceedByteLimit()
  ) {
    return false;
  }
  if (!writer.append('"')) {
    return false;
  }

  for (let start = 0; start < value.length;) {
    let end = Math.min(value.length, start + stringChunkSize);
    const last = value.charCodeAt(end - 1);
    const next = value.charCodeAt(end);
    if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
      end += 1;
    }

    const encoded = JSON.stringify(value.slice(start, end)).slice(1, -1);
    if (!writer.append(encoded)) {
      return false;
    }
    start = end;
  }
  return writer.append('"');
};

const serializeNode = (
  node: JsonNode,
  writer: BoundedWriter,
  nodeLimit: number,
): SerializationResult => {
  const pending: SerializationTask[] = [
    { type: "value", source: { representation: "node", value: node }, depth: 0 },
  ];
  let visited = 0;

  while (pending.length > 0) {
    const task = pending.pop()!;
    if (task.type === "value") {
      visited += 1;
      if (visited > nodeLimit) {
        return { complete: false, nodeLimitExceeded: true };
      }

      const resolved = resolveValue(task.source);
      if (resolved.type === "literal") {
        if (!writer.append(resolved.value)) {
          return { complete: false, nodeLimitExceeded: false };
        }
        continue;
      }
      if (resolved.type === "string") {
        if (!writeJsonString(writer, resolved.value)) {
          return { complete: false, nodeLimitExceeded: false };
        }
        continue;
      }

      if (!writer.append(resolved.cursor.kind === "array" ? "[" : "{")) {
        return { complete: false, nodeLimitExceeded: false };
      }
      pending.push({ type: "container", cursor: resolved.cursor, index: 0, depth: task.depth });
      continue;
    }

    const next = task.cursor.next();
    if (next.done) {
      if (task.index > 0) {
        if (!writer.append("\n") || !writer.append(indentation.repeat(task.depth))) {
          return { complete: false, nodeLimitExceeded: false };
        }
      }
      if (!writer.append(task.cursor.kind === "array" ? "]" : "}")) {
        return { complete: false, nodeLimitExceeded: false };
      }
      continue;
    }

    if (task.index > 0 && (!writer.append(",") || !writer.append("\n"))) {
      return { complete: false, nodeLimitExceeded: false };
    }
    if (task.index === 0 && !writer.append("\n")) {
      return { complete: false, nodeLimitExceeded: false };
    }
    if (!writer.append(indentation.repeat(task.depth + 1))) {
      return { complete: false, nodeLimitExceeded: false };
    }
    if (task.cursor.kind === "object") {
      if (!writeJsonString(writer, next.value.key) || !writer.append(": ")) {
        return { complete: false, nodeLimitExceeded: false };
      }
    }

    pending.push({ ...task, index: task.index + 1 });
    pending.push({ type: "value", source: next.value.value, depth: task.depth + 1 });
  }

  return { complete: true, nodeLimitExceeded: false };
};

const hasKeyPrefix = (selection: SelectedPath) =>
  selection.rawKey !== "$" && !isArrayElementPath(selection.pathText);

const writeSelectionPrefix = (writer: BoundedWriter, selection: SelectedPath) =>
  !hasKeyPrefix(selection) || (writeJsonString(writer, selection.rawKey) && writer.append(": "));

const measureSelectionPrefix = (selection: SelectedPath) => {
  const writer = new BoundedWriter(copyBytesLimit, 0, false, "size");
  const complete = writeSelectionPrefix(writer, selection);
  return { byteLength: writer.byteLength, blocked: !complete || writer.byteLimitExceeded };
};

const minimumSerializedBytes = (node: JsonNode) => {
  if (node.kind === "string") {
    return node.value.length + 2;
  }
  if (node.kind === "number") {
    return stringifyJsonNode(node).length;
  }
  if (node.kind === "boolean") {
    return node.value ? 4 : 5;
  }
  if (node.kind === "null") {
    return 4;
  }
  return 2;
};

const formatSelectionCopy = (selection: SelectedPath, node: JsonNode) => {
  const writer = new BoundedWriter(copyBytesLimit, Number.POSITIVE_INFINITY, true, "size");
  const prefixComplete = writeSelectionPrefix(writer, selection);
  const serialized = prefixComplete
    ? serializeNode(node, writer, inspectorNodeLimit)
    : { complete: false, nodeLimitExceeded: false };

  if (!serialized.complete || serialized.nodeLimitExceeded || writer.byteLimitExceeded) {
    throw new RangeError("Selected node exceeds its copy budget");
  }
  return writer.text();
};

const projectResolvedNode = (selection: SelectedPath, node: JsonNode): SelectedNodeProjection => {
  const prefix = measureSelectionPrefix(selection);
  const remainingBytes = copyBytesLimit - prefix.byteLength;
  const copyCannotFit = prefix.blocked || minimumSerializedBytes(node) > remainingBytes;
  const byteLimit = copyCannotFit ? 0 : remainingBytes;
  const writer = new BoundedWriter(byteLimit, inspectorCharLimit, true, "preview-and-size");
  const serialized = serializeNode(node, writer, inspectorNodeLimit);

  if (serialized.nodeLimitExceeded) {
    return { kind: "too-large", selection, copy: { kind: "blocked" } };
  }

  const copyBlocked = copyCannotFit || writer.byteLimitExceeded || !serialized.complete;
  return {
    kind: "value",
    selection,
    text: writer.text(),
    truncated: writer.charLimitExceeded,
    copy: copyBlocked
      ? { kind: "blocked" }
      : { kind: "available", format: () => formatSelectionCopy(selection, node) },
  };
};

export const projectSelectedNode = (
  record: JsonlRecord | null,
  selection: SelectedPath | null,
): SelectedNodeProjection => {
  if (!record || !selection || selection.recordId !== record.id) {
    return { kind: "empty", copy: { kind: "blocked" } };
  }
  if (record.status === "preview") {
    return { kind: "loading", selection, copy: { kind: "blocked" } };
  }
  if (record.status === "failed") {
    return { kind: "empty", copy: { kind: "blocked" } };
  }

  const resolved = resolveTreePath([record], selection.pathText, record.id);
  return resolved.ok
    ? projectResolvedNode(selection, resolved.target.node)
    : { kind: "empty", copy: { kind: "blocked" } };
};
