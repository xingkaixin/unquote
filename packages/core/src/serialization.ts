import type { FormatOptions, JsonNode, LosslessJsonValue, MaterializeOptions } from "./types.js";
import {
  materializeJsonNumber,
  materializeLosslessValue,
  validateJsonNumberLexeme,
} from "./lossless-json.js";
import { truncateAtCodePointBoundary } from "./utils.js";

type SerializableValue =
  | { representation: "node"; value: JsonNode }
  | { representation: "lossless"; value: LosslessJsonValue };

interface ContainerView {
  kind: "object" | "array";
  length: number;
  keyAt: (index: number) => string;
  valueAt: (index: number) => SerializableValue;
}

type ResolvedValue = { literal: string } | { string: string } | { container: ContainerView };

const jsonLiteral = (value: string | boolean | null) => JSON.stringify(value);

const resolveLosslessValue = (value: LosslessJsonValue): ResolvedValue => {
  if (typeof value === "string") {
    return { string: value };
  }
  if (value === null || typeof value === "boolean") {
    return { literal: jsonLiteral(value) };
  }
  if (value.type === "number") {
    return { literal: validateJsonNumberLexeme(value.rawValue) };
  }
  if (value.type === "array") {
    return {
      container: {
        kind: "array",
        length: value.items.length,
        keyAt: (index) => String(index),
        valueAt: (index) => ({ representation: "lossless", value: value.items[index]! }),
      },
    };
  }

  const keys = Object.keys(value.entries);
  return {
    container: {
      kind: "object",
      length: keys.length,
      keyAt: (index) => keys[index]!,
      valueAt: (index) => ({
        representation: "lossless",
        value: value.entries[keys[index]!]!,
      }),
    },
  };
};

const resolveNode = (node: JsonNode): ResolvedValue => {
  if (node.kind === "object") {
    if (node.children) {
      const keys = Object.keys(node.children);
      return {
        container: {
          kind: "object",
          length: keys.length,
          keyAt: (index) => keys[index]!,
          valueAt: (index) => ({
            representation: "node",
            value: node.children[keys[index]!]!,
          }),
        },
      };
    }
    return node.preview ? { literal: "null" } : resolveLosslessValue(node.value);
  }

  if (node.kind === "array") {
    if (node.children) {
      return {
        container: {
          kind: "array",
          length: node.children.length,
          keyAt: (index) => String(index),
          valueAt: (index) => ({ representation: "node", value: node.children[index]! }),
        },
      };
    }
    return node.preview ? { literal: "null" } : resolveLosslessValue(node.value);
  }

  if (node.kind === "number") {
    return {
      literal:
        node.rawValue !== undefined
          ? validateJsonNumberLexeme(node.rawValue)
          : Number.isFinite(node.value)
            ? String(node.value)
            : "null",
    };
  }
  if (node.kind === "string") {
    return { string: node.value };
  }
  return { literal: jsonLiteral(node.value) };
};

const resolveValue = (source: SerializableValue) =>
  source.representation === "node" ? resolveNode(source.value) : resolveLosslessValue(source.value);

type SerializationTask =
  | { type: "value"; source: SerializableValue; depth: number }
  | { type: "container"; view: ContainerView; index: number; depth: number };

const normalizedIndent = (indent: number | undefined) => {
  if (typeof indent !== "number" || Number.isNaN(indent)) {
    return 0;
  }
  return Math.max(0, Math.min(10, Math.trunc(indent)));
};

export interface JsonSerializationLimits {
  maxCharacters?: number;
  maxBytes?: number;
  maxNodes?: number;
}

export interface JsonSerializationResult {
  text: string;
  complete: boolean;
  characterLimitExceeded: boolean;
  byteLimitExceeded: boolean;
  nodeLimitExceeded: boolean;
}

interface SerializationWriter {
  append(value: string): boolean;
  appendJsonString(value: string): boolean;
  finish(complete: boolean, nodeLimitExceeded: boolean): JsonSerializationResult;
}

const normalizedMaxLength = (maxLength: number) =>
  Number.isFinite(maxLength) ? Math.max(0, Math.trunc(maxLength)) : 0;

const normalizedOptionalLimit = (limit: number | undefined) =>
  limit === undefined ? undefined : normalizedMaxLength(limit);

const textEncoder = new TextEncoder();
const stringChunkSize = 16_384;

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
    return { bytes: encodedLength, codeUnits: value.length };
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
  return { bytes, codeUnits: index };
};

const createWriter = (limits: JsonSerializationLimits): SerializationWriter => {
  const maxCharacters = normalizedOptionalLimit(limits.maxCharacters);
  const maxBytes = normalizedOptionalLimit(limits.maxBytes);
  const chunks: string[] = [];
  let characterLength = 0;
  let byteLength = 0;
  let characterLimitExceeded = false;
  let byteLimitExceeded = false;

  const shouldContinue = () => {
    if (maxCharacters !== undefined && maxBytes !== undefined) {
      return !(characterLimitExceeded && byteLimitExceeded);
    }
    if (maxCharacters !== undefined) {
      return !characterLimitExceeded;
    }
    if (maxBytes !== undefined) {
      return !byteLimitExceeded;
    }
    return true;
  };

  const append = (value: string) => {
    if (!characterLimitExceeded) {
      if (maxCharacters === undefined || characterLength + value.length <= maxCharacters) {
        chunks.push(value);
        characterLength += value.length;
      } else {
        const prefix = truncateAtCodePointBoundary(value, maxCharacters - characterLength);
        if (prefix) {
          chunks.push(prefix);
          characterLength += prefix.length;
        }
        characterLimitExceeded = true;
      }
    }

    if (!byteLimitExceeded && maxBytes !== undefined) {
      const prefix = utf8PrefixWithin(value, maxBytes - byteLength);
      byteLength += prefix.bytes;
      byteLimitExceeded = prefix.codeUnits < value.length;
    }
    return shouldContinue();
  };

  return {
    append,
    appendJsonString(value) {
      if (maxCharacters === undefined && maxBytes === undefined) {
        return append(jsonLiteral(value));
      }
      if (!append('"')) {
        return false;
      }

      for (let start = 0; start < value.length;) {
        let end = Math.min(value.length, start + stringChunkSize);
        const last = value.charCodeAt(end - 1);
        const next = value.charCodeAt(end);
        if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
          end += 1;
        }
        if (!append(jsonLiteral(value.slice(start, end)).slice(1, -1))) {
          return false;
        }
        start = end;
      }
      return append('"');
    },
    finish: (complete, nodeLimitExceeded) => ({
      text: chunks.join(""),
      complete,
      characterLimitExceeded,
      byteLimitExceeded,
      nodeLimitExceeded,
    }),
  };
};

const serializeJsonNode = (
  node: JsonNode,
  options: FormatOptions,
  limits: JsonSerializationLimits = {},
): JsonSerializationResult => {
  const indentation = " ".repeat(normalizedIndent(options.indent));
  const pretty = indentation.length > 0;
  const writer = createWriter(limits);
  const pending: SerializationTask[] = [
    { type: "value", source: { representation: "node", value: node }, depth: 0 },
  ];

  const maxNodes = normalizedOptionalLimit(limits.maxNodes);
  let visited = 0;
  let complete = true;
  let nodeLimitExceeded = false;

  while (pending.length > 0) {
    const task = pending.pop()!;
    if (task.type === "value") {
      if (maxNodes !== undefined && visited >= maxNodes) {
        complete = false;
        nodeLimitExceeded = true;
        break;
      }
      visited += 1;
      const resolved = resolveValue(task.source);
      if ("literal" in resolved) {
        if (!writer.append(resolved.literal)) {
          complete = false;
          break;
        }
        continue;
      }
      if ("string" in resolved) {
        if (!writer.appendJsonString(resolved.string)) {
          complete = false;
          break;
        }
        continue;
      }

      const { container } = resolved;
      if (!writer.append(container.kind === "array" ? "[" : "{")) {
        complete = false;
        break;
      }
      if (container.length === 0) {
        writer.append(container.kind === "array" ? "]" : "}");
        continue;
      }
      if (pretty && !writer.append("\n")) {
        complete = false;
        break;
      }
      pending.push({ type: "container", view: container, index: 0, depth: task.depth });
      continue;
    }

    if (task.index >= task.view.length) {
      if (pretty && !writer.append(`\n${indentation.repeat(task.depth)}`)) {
        complete = false;
        break;
      }
      if (!writer.append(task.view.kind === "array" ? "]" : "}")) {
        complete = false;
        break;
      }
      continue;
    }

    if (task.index > 0 && !writer.append(pretty ? ",\n" : ",")) {
      complete = false;
      break;
    }
    if (pretty && !writer.append(indentation.repeat(task.depth + 1))) {
      complete = false;
      break;
    }
    if (task.view.kind === "object") {
      if (
        !writer.appendJsonString(task.view.keyAt(task.index)) ||
        !writer.append(pretty ? ": " : ":")
      ) {
        complete = false;
        break;
      }
    }

    if (maxNodes !== undefined && visited >= maxNodes) {
      complete = false;
      nodeLimitExceeded = true;
      break;
    }

    pending.push({ ...task, index: task.index + 1 });
    pending.push({
      type: "value",
      source: task.view.valueAt(task.index),
      depth: task.depth + 1,
    });
  }

  return writer.finish(complete, nodeLimitExceeded);
};

export const stringifyJsonNode = (node: JsonNode, options: FormatOptions = {}) =>
  serializeJsonNode(node, options).text;

export const stringifyJsonNodeWithLimits = (
  node: JsonNode,
  limits: JsonSerializationLimits,
  options: FormatOptions = {},
) => serializeJsonNode(node, options, limits);

export const stringifyJsonNodeBounded = (
  node: JsonNode,
  maxLength: number,
  options: FormatOptions = {},
) => {
  const result = serializeJsonNode(node, options, {
    maxCharacters: normalizedMaxLength(maxLength),
  });
  return { text: result.text, truncated: result.characterLimitExceeded };
};

export const materializeNode = (node: JsonNode, options: MaterializeOptions = {}): unknown => {
  if (node.kind === "object" && node.children) {
    return Object.fromEntries(
      Object.entries(node.children).map(([key, child]) => [key, materializeNode(child, options)]),
    );
  }

  if (node.kind === "array" && node.children) {
    return node.children.map((child) => materializeNode(child, options));
  }

  if (node.kind === "object" || node.kind === "array") {
    return node.preview ? null : materializeLosslessValue(node.value, options);
  }

  if (node.kind === "number" && node.rawValue !== undefined) {
    return materializeJsonNumber(node.rawValue, options);
  }
  return node.value;
};
