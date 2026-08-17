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

interface SerializationResult {
  text: string;
  truncated: boolean;
}

interface SerializationWriter {
  append(value: string): boolean;
  appendJsonString(value: string): boolean;
  finish(): SerializationResult;
  readonly truncated: boolean;
}

const normalizedMaxLength = (maxLength: number) =>
  Number.isFinite(maxLength) ? Math.max(0, Math.trunc(maxLength)) : 0;

const createWriter = (maxLength?: number): SerializationWriter => {
  const chunks: string[] = [];
  let length = 0;
  let truncated = false;

  const append = (value: string) => {
    if (truncated) {
      return false;
    }
    if (maxLength === undefined || length + value.length <= maxLength) {
      chunks.push(value);
      length += value.length;
      return true;
    }

    const prefix = truncateAtCodePointBoundary(value, maxLength - length);
    if (prefix) {
      chunks.push(prefix);
      length += prefix.length;
    }
    truncated = true;
    return false;
  };

  return {
    append,
    appendJsonString(value) {
      if (maxLength === undefined) {
        return append(jsonLiteral(value));
      }
      if (!append('"')) {
        return false;
      }
      for (const character of value) {
        if (!append(jsonLiteral(character).slice(1, -1))) {
          return false;
        }
      }
      return append('"');
    },
    finish: () => ({ text: chunks.join(""), truncated }),
    get truncated() {
      return truncated;
    },
  };
};

const serializeJsonNode = (
  node: JsonNode,
  options: FormatOptions,
  maxLength?: number,
): SerializationResult => {
  const indentation = " ".repeat(normalizedIndent(options.indent));
  const pretty = indentation.length > 0;
  const writer = createWriter(maxLength);
  const pending: SerializationTask[] = [
    { type: "value", source: { representation: "node", value: node }, depth: 0 },
  ];

  while (pending.length > 0 && !writer.truncated) {
    const task = pending.pop()!;
    if (task.type === "value") {
      const resolved = resolveValue(task.source);
      if ("literal" in resolved) {
        writer.append(resolved.literal);
        continue;
      }
      if ("string" in resolved) {
        writer.appendJsonString(resolved.string);
        continue;
      }

      const { container } = resolved;
      if (!writer.append(container.kind === "array" ? "[" : "{")) {
        break;
      }
      if (container.length === 0) {
        writer.append(container.kind === "array" ? "]" : "}");
        continue;
      }
      if (pretty && !writer.append("\n")) {
        break;
      }
      pending.push({ type: "container", view: container, index: 0, depth: task.depth });
      continue;
    }

    if (task.index >= task.view.length) {
      if (pretty && !writer.append(`\n${indentation.repeat(task.depth)}`)) {
        break;
      }
      writer.append(task.view.kind === "array" ? "]" : "}");
      continue;
    }

    if (task.index > 0 && !writer.append(pretty ? ",\n" : ",")) {
      break;
    }
    if (pretty && !writer.append(indentation.repeat(task.depth + 1))) {
      break;
    }
    if (task.view.kind === "object") {
      if (
        !writer.appendJsonString(task.view.keyAt(task.index)) ||
        !writer.append(pretty ? ": " : ":")
      ) {
        break;
      }
    }

    pending.push({ ...task, index: task.index + 1 });
    pending.push({
      type: "value",
      source: task.view.valueAt(task.index),
      depth: task.depth + 1,
    });
  }

  return writer.finish();
};

export const stringifyJsonNode = (node: JsonNode, options: FormatOptions = {}) =>
  serializeJsonNode(node, options).text;

export const stringifyJsonNodeBounded = (
  node: JsonNode,
  maxLength: number,
  options: FormatOptions = {},
) => serializeJsonNode(node, options, normalizedMaxLength(maxLength));

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
