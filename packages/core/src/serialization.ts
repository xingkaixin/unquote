import type { FormatOptions, JsonNode, LosslessJsonValue, MaterializeOptions } from "./types.js";
import {
  materializeJsonNumber,
  materializeLosslessValue,
  validateJsonNumberLexeme,
} from "./lossless-json.js";

type SerializableValue =
  | { representation: "node"; value: JsonNode }
  | { representation: "lossless"; value: LosslessJsonValue };

interface ContainerView {
  kind: "object" | "array";
  length: number;
  keyAt: (index: number) => string;
  valueAt: (index: number) => SerializableValue;
}

type ResolvedValue = { literal: string } | { container: ContainerView };

const jsonLiteral = (value: string | boolean | null) => JSON.stringify(value);

const resolveLosslessValue = (value: LosslessJsonValue): ResolvedValue => {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
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

export const stringifyJsonNode = (node: JsonNode, options: FormatOptions = {}) => {
  const indentation = " ".repeat(normalizedIndent(options.indent));
  const pretty = indentation.length > 0;
  const chunks: string[] = [];
  const pending: SerializationTask[] = [
    { type: "value", source: { representation: "node", value: node }, depth: 0 },
  ];

  while (pending.length > 0) {
    const task = pending.pop()!;
    if (task.type === "value") {
      const resolved = resolveValue(task.source);
      if ("literal" in resolved) {
        chunks.push(resolved.literal);
        continue;
      }

      const { container } = resolved;
      chunks.push(container.kind === "array" ? "[" : "{");
      if (container.length === 0) {
        chunks.push(container.kind === "array" ? "]" : "}");
        continue;
      }
      if (pretty) {
        chunks.push("\n");
      }
      pending.push({ type: "container", view: container, index: 0, depth: task.depth });
      continue;
    }

    if (task.index >= task.view.length) {
      if (pretty) {
        chunks.push("\n", indentation.repeat(task.depth));
      }
      chunks.push(task.view.kind === "array" ? "]" : "}");
      continue;
    }

    if (task.index > 0) {
      chunks.push(",", pretty ? "\n" : "");
    }
    if (pretty) {
      chunks.push(indentation.repeat(task.depth + 1));
    }
    if (task.view.kind === "object") {
      chunks.push(JSON.stringify(task.view.keyAt(task.index)), pretty ? ": " : ":");
    }

    pending.push({ ...task, index: task.index + 1 });
    pending.push({
      type: "value",
      source: task.view.valueAt(task.index),
      depth: task.depth + 1,
    });
  }

  return chunks.join("");
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
