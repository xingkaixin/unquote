import { DEFAULT_MAX_DEPTH, truncateAtCodePointBoundary } from "@unquote/core";

const previewLimit = 160;
const blockTextLimit = 8000;
const truncationSuffix = "... [truncated]";
const workItemsPerCharacter = 2;

type ContainerValue = unknown[] | Record<string, unknown>;

type Frame =
  | { type: "value"; value: unknown; depth: number }
  | {
      type: "array";
      value: unknown[];
      index: number;
      length: number;
      depth: number;
    }
  | {
      type: "object";
      value: Record<string, unknown>;
      keys: Iterator<string>;
      hasEntries: boolean;
      depth: number;
    };

type Layout = "compact" | "pretty";

interface Writer {
  append: (value: string) => boolean;
  finish: () => string;
  truncate: () => void;
  readonly truncated: boolean;
}

const createWriter = (limit: number): Writer => {
  const parts: string[] = [];
  let length = 0;
  let truncated = false;

  return {
    append(value) {
      if (truncated || value.length === 0) {
        return !truncated;
      }

      const remaining = limit - length;
      if (value.length <= remaining) {
        parts.push(value);
        length += value.length;
        return true;
      }

      const prefix = truncateAtCodePointBoundary(value, remaining);
      if (prefix) {
        parts.push(prefix);
        length += prefix.length;
      }
      truncated = true;
      return false;
    },
    finish() {
      return `${parts.join("")}${truncated ? truncationSuffix : ""}`;
    },
    truncate() {
      truncated = true;
    },
    get truncated() {
      return truncated;
    },
  };
};

const writeJsonString = (writer: Writer, value: string) => {
  if (!writer.append('"')) {
    return;
  }

  for (let index = 0; index < value.length && !writer.truncated; index += 1) {
    const code = value.charCodeAt(index);
    const character = value[index]!;
    if (character === '"') {
      writer.append('\\"');
    } else if (character === "\\") {
      writer.append("\\\\");
    } else if (character === "\b") {
      writer.append("\\b");
    } else if (character === "\f") {
      writer.append("\\f");
    } else if (character === "\n") {
      writer.append("\\n");
    } else if (character === "\r") {
      writer.append("\\r");
    } else if (character === "\t") {
      writer.append("\\t");
    } else if (code < 0x20 || (code >= 0xdc00 && code <= 0xdfff)) {
      writer.append(`\\u${code.toString(16).padStart(4, "0")}`);
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const nextCode = value.charCodeAt(index + 1);
      if (nextCode >= 0xdc00 && nextCode <= 0xdfff) {
        writer.append(value.slice(index, index + 2));
        index += 1;
      } else {
        writer.append(`\\u${code.toString(16).padStart(4, "0")}`);
      }
    } else {
      writer.append(character);
    }
  }

  if (!writer.truncated) {
    writer.append('"');
  }
};

function* ownEnumerableKeys(value: Record<string, unknown>): Generator<string> {
  for (const key in value) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      yield key;
    }
  }
}

const isUnsupportedValue = (value: unknown) =>
  value === undefined || typeof value === "function" || typeof value === "symbol";

const writePrimitive = (writer: Writer, value: unknown) => {
  if (typeof value === "string") {
    writeJsonString(writer, value);
    return true;
  }
  if (typeof value === "number") {
    writer.append(Number.isFinite(value) ? String(value) : "null");
    return true;
  }
  if (typeof value === "boolean" || value === null) {
    writer.append(String(value));
    return true;
  }
  if (typeof value === "bigint") {
    writeJsonString(writer, String(value));
    return true;
  }
  return false;
};

const containerPrefix = (layout: Layout, depth: number, hasEntries: boolean) => {
  if (layout === "compact") {
    return hasEntries ? "," : "";
  }
  return `${hasEntries ? "," : ""}\n${"  ".repeat(depth + 1)}`;
};

const containerSuffix = (layout: Layout, depth: number, hasEntries: boolean) =>
  layout === "pretty" && hasEntries ? `\n${"  ".repeat(depth)}` : "";

const serializeBounded = (value: unknown, layout: Layout, limit: number) => {
  const writer = createWriter(limit);
  const activeContainers = new Set<ContainerValue>();
  const stack: Frame[] = [{ type: "value", value, depth: 0 }];
  const workLimit = Math.max(limit * workItemsPerCharacter, DEFAULT_MAX_DEPTH);
  let workItems = 0;

  while (stack.length > 0 && !writer.truncated) {
    workItems += 1;
    if (workItems > workLimit) {
      writer.truncate();
      break;
    }

    const frame = stack.pop()!;
    if (frame.type === "value") {
      if (writePrimitive(writer, frame.value)) {
        continue;
      }
      if (isUnsupportedValue(frame.value)) {
        writer.append("null");
        continue;
      }
      if (typeof frame.value !== "object" || frame.value === null) {
        writer.append("null");
        continue;
      }
      const container = frame.value as ContainerValue;
      if (frame.depth >= DEFAULT_MAX_DEPTH || activeContainers.has(container)) {
        writer.truncate();
        continue;
      }

      activeContainers.add(container);
      if (Array.isArray(frame.value)) {
        let length: number;
        try {
          length = frame.value.length;
        } catch {
          writer.truncate();
          continue;
        }
        writer.append("[");
        stack.push({
          type: "array",
          value: frame.value,
          index: 0,
          length,
          depth: frame.depth,
        });
      } else {
        writer.append("{");
        stack.push({
          type: "object",
          value: frame.value as Record<string, unknown>,
          keys: ownEnumerableKeys(frame.value as Record<string, unknown>),
          hasEntries: false,
          depth: frame.depth,
        });
      }
      continue;
    }

    if (frame.type === "array") {
      if (frame.index >= frame.length) {
        writer.append(containerSuffix(layout, frame.depth, frame.index > 0));
        writer.append("]");
        activeContainers.delete(frame.value);
        continue;
      }

      let item: unknown;
      try {
        item = frame.value[frame.index];
      } catch {
        writer.truncate();
        continue;
      }
      writer.append(containerPrefix(layout, frame.depth, frame.index > 0));
      stack.push({ ...frame, index: frame.index + 1 });
      stack.push({ type: "value", value: item, depth: frame.depth + 1 });
      continue;
    }

    let nextKey: IteratorResult<string>;
    try {
      nextKey = frame.keys.next();
    } catch {
      writer.truncate();
      continue;
    }
    if (nextKey.done) {
      writer.append(containerSuffix(layout, frame.depth, frame.hasEntries));
      writer.append("}");
      activeContainers.delete(frame.value);
      continue;
    }

    let item: unknown;
    try {
      item = frame.value[nextKey.value];
    } catch {
      item = "[unavailable]";
    }
    stack.push(frame);
    if (isUnsupportedValue(item)) {
      continue;
    }

    writer.append(containerPrefix(layout, frame.depth, frame.hasEntries));
    writeJsonString(writer, nextKey.value);
    writer.append(layout === "compact" ? ":" : ": ");
    frame.hasEntries = true;
    stack.push({ type: "value", value: item, depth: frame.depth + 1 });
  }

  return writer.finish();
};

export const truncateText = (value: string, limit: number) =>
  value.length <= limit ? value : `${truncateAtCodePointBoundary(value, limit)}${truncationSuffix}`;

export const truncatePreview = (value: string) =>
  truncateText(value.replace(/\s+/g, " ").trim(), previewLimit);

export const truncateBlockText = (value: string) => truncateText(value, blockTextLimit);

export const formatAgentBlockValue = (value: unknown) => {
  if (typeof value === "string") {
    return truncateBlockText(value);
  }
  if (value === undefined || value === null) {
    return "";
  }
  return serializeBounded(value, "pretty", blockTextLimit);
};

export const formatAgentPreviewValue = (value: unknown) =>
  truncatePreview(formatAgentBlockValue(value));

export const formatAgentFieldValue = (value: unknown) => {
  if (typeof value === "string") {
    return truncateBlockText(value);
  }
  return serializeBounded(value, "compact", blockTextLimit);
};
