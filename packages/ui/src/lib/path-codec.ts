export type TreePathSegmentKind = "key" | "index";

export interface TreePathSegment {
  kind: TreePathSegmentKind;
  value: string;
}

const safeIdentifierPattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const arrayIndexPattern = /^(0|[1-9]\d*)$/;

const quotePathKey = (key: string) => JSON.stringify(key);

export const appendJsonPathSegment = (path: string, segment: TreePathSegment) => {
  if (segment.kind === "index") {
    return `${path}[${segment.value}]`;
  }

  if (safeIdentifierPattern.test(segment.value)) {
    return `${path}.${segment.value}`;
  }

  return `${path}[${quotePathKey(segment.value)}]`;
};

export const appendJqSelectorSegment = (path: string, segment: TreePathSegment) => {
  if (segment.kind === "index") {
    return `${path}[${segment.value}]`;
  }

  if (safeIdentifierPattern.test(segment.value)) {
    return path === "." ? `${path}${segment.value}` : `${path}.${segment.value}`;
  }

  return `${path}[${quotePathKey(segment.value)}]`;
};

export const formatJsonPath = (segments: TreePathSegment[]) =>
  segments.reduce((path, segment) => appendJsonPathSegment(path, segment), "$");

export const formatJqSelector = (segments: TreePathSegment[]) => {
  if (segments.length === 0) {
    return ".";
  }

  return segments.reduce((path, segment) => appendJqSelectorSegment(path, segment), ".");
};

const parseDoubleQuotedSegment = (selector: string, start: number) => {
  let cursor = start + 1;
  while (cursor < selector.length) {
    const char = selector[cursor];
    if (char === "\\") {
      cursor += 2;
      continue;
    }
    if (char === '"') {
      try {
        const value = JSON.parse(selector.slice(start, cursor + 1));
        return typeof value === "string" ? { value, next: cursor + 1 } : null;
      } catch {
        return null;
      }
    }
    cursor += 1;
  }

  return null;
};

const parseSingleQuotedSegment = (selector: string, start: number) => {
  let cursor = start + 1;
  let value = "";

  while (cursor < selector.length) {
    const char = selector[cursor];
    if (char === "\\") {
      const escaped = selector[cursor + 1];
      if (!escaped) {
        return null;
      }

      const escapeMap: Record<string, string> = {
        "'": "'",
        '"': '"',
        "\\": "\\",
        b: "\b",
        f: "\f",
        n: "\n",
        r: "\r",
        t: "\t",
      };
      value += escapeMap[escaped] ?? escaped;
      cursor += 2;
      continue;
    }

    if (char === "'") {
      return { value, next: cursor + 1 };
    }

    value += char;
    cursor += 1;
  }

  return null;
};

const parseBracketSegment = (selector: string, start: number) => {
  const first = selector[start + 1];
  if (first === '"') {
    const parsed = parseDoubleQuotedSegment(selector, start + 1);
    if (!parsed || selector[parsed.next] !== "]") {
      return null;
    }

    return {
      segment: { kind: "key", value: parsed.value } satisfies TreePathSegment,
      next: parsed.next + 1,
    };
  }

  if (first === "'") {
    const parsed = parseSingleQuotedSegment(selector, start + 1);
    if (!parsed || selector[parsed.next] !== "]") {
      return null;
    }

    return {
      segment: { kind: "key", value: parsed.value } satisfies TreePathSegment,
      next: parsed.next + 1,
    };
  }

  const end = selector.indexOf("]", start + 1);
  if (end === -1) {
    return null;
  }

  const value = selector.slice(start + 1, end).trim();
  if (!arrayIndexPattern.test(value)) {
    return null;
  }

  return {
    segment: { kind: "index", value } satisfies TreePathSegment,
    next: end + 1,
  };
};

export const parseTreePath = (selector: string): TreePathSegment[] | null => {
  const input = selector.trim();
  if (!input) {
    return null;
  }

  let index = 0;
  if (input[0] === "$") {
    index = 1;
  } else if (input[0] !== ".") {
    return null;
  } else if (input.length === 1) {
    return [];
  }

  const segments: TreePathSegment[] = [];
  while (index < input.length) {
    const char = input[index];
    if (char === ".") {
      index += 1;
      if (index >= input.length) {
        return null;
      }

      if (input[index] === "[") {
        continue;
      }

      const start = index;
      while (index < input.length && input[index] !== "." && input[index] !== "[") {
        index += 1;
      }

      const value = input.slice(start, index);
      if (!value) {
        return null;
      }

      segments.push({ kind: "key", value });
      continue;
    }

    if (char === "[") {
      const parsed = parseBracketSegment(input, index);
      if (!parsed) {
        return null;
      }

      segments.push(parsed.segment);
      index = parsed.next;
      continue;
    }

    return null;
  }

  return segments;
};
