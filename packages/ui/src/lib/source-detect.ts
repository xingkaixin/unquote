const sseFieldNames = ["data", "event", "id", "retry"] as const;

const sseFieldAt = (input: string, start: number) =>
  sseFieldNames.find((name) => {
    if (!input.startsWith(name, start)) {
      return false;
    }
    const next = input[start + name.length];
    return next === undefined || next === ":" || next === "\n" || next === "\r";
  });

const isLikelySse = (input: string, sampleLimit = 8) => {
  let sampled = 0;
  let hasData = false;
  let start = input.startsWith("\uFEFF") ? 1 : 0;

  while (sampled < sampleLimit) {
    let first = start;
    while (input[first] === " " || input[first] === "\t" || input[first] === "\r") {
      first += 1;
    }
    if (first < input.length && input[first] !== "\n") {
      if (first !== start) {
        return false;
      }
      sampled += 1;
      if (input[start] !== ":") {
        const field = sseFieldAt(input, start);
        if (!field) {
          return false;
        }
        hasData ||= field === "data";
      }
    }

    const newline = input.indexOf("\n", first);
    if (newline < 0) {
      break;
    }
    start = newline + 1;
  }

  return hasData;
};

export type SourceDetection =
  | { kind: "empty" }
  | { kind: "json" }
  | { kind: "jsonl"; lines: number; precision: "exact" | "lower-bound" }
  | { kind: "sse" }
  | { kind: "invalid" };

export const sourceDetectionProbeByteBudget = 64 * 1024;

export const largeFileJsonlProbeByteBudget = 256 * 1024;

export const sourceDetectionLineBudget = 40;

const parses = (text: string) => {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
};

interface DraftLines {
  count: number;
  precision: "exact" | "lower-bound";
  probe: string[];
  firstNonWhitespace: string | null;
  incompleteLineFirstChar: string | null;
}

const isJsonContainerStart = (char: string | null) => char === "{" || char === "[";

const lastNonWhitespaceChar = (text: string) => {
  for (let index = text.length - 1; index >= 0; index -= 1) {
    if (text.charCodeAt(index) > 32) {
      return text[index] ?? null;
    }
  }
  return null;
};

const trimLine = (text: string, start: number, end: number) => {
  while (start < end && text.charCodeAt(start) <= 32) {
    start += 1;
  }
  while (end > start && text.charCodeAt(end - 1) <= 32) {
    end -= 1;
  }
  return { start, end };
};

const scanLines = (text: string, byteBudget: number): DraftLines => {
  const probe: string[] = [];
  let count = 0;
  let bytes = 0;
  let index = 0;
  let lineStart = 0;
  let firstNonWhitespace: string | null = null;
  let incompleteLineFirstChar: string | null = null;

  const collectLine = (end: number, complete: boolean) => {
    const trimmed = trimLine(text, lineStart, end);
    if (trimmed.start < trimmed.end) {
      count += 1;
      if (complete) {
        probe.push(text.slice(trimmed.start, trimmed.end));
      } else {
        incompleteLineFirstChar = text[trimmed.start] ?? null;
      }
    }
  };

  while (index < text.length && count < sourceDetectionLineBudget) {
    const code = text.charCodeAt(index);
    let byteWidth = 3;
    let unitWidth = 1;
    if (code <= 0x7f) {
      byteWidth = 1;
    } else if (code <= 0x7ff) {
      byteWidth = 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        byteWidth = 4;
        unitWidth = 2;
      }
    }

    if (bytes + byteWidth > byteBudget) {
      break;
    }

    if (firstNonWhitespace === null && code > 32 && code !== 0xfeff) {
      firstNonWhitespace = text[index] ?? null;
    }

    bytes += byteWidth;
    index += unitWidth;
    if (code === 10) {
      collectLine(index - 1, true);
      lineStart = index;
    }
  }

  if (index === text.length) {
    collectLine(index, true);
    return { count, precision: "exact", probe, firstNonWhitespace, incompleteLineFirstChar };
  }

  collectLine(index, false);
  return { count, precision: "lower-bound", probe, firstNonWhitespace, incompleteLineFirstChar };
};

const isJsonlScan = (scan: DraftLines) => {
  if (scan.count <= 1) {
    return false;
  }
  if (scan.probe.length === 1) {
    return (
      scan.precision === "lower-bound" &&
      isJsonContainerStart(scan.incompleteLineFirstChar) &&
      parses(scan.probe[0]!)
    );
  }
  if (scan.probe.length < 2) {
    return false;
  }

  let validCount = 0;
  for (const line of scan.probe) {
    if (parses(line)) {
      validCount += 1;
    }
  }

  return validCount >= 2 && validCount * 2 > scan.probe.length;
};

export const detectSourceFormatInBudget = (text: string, byteBudget: number): SourceDetection => {
  const scan = scanLines(text, byteBudget);
  if (scan.count === 0 && scan.precision === "exact") {
    return { kind: "empty" };
  }

  if (isJsonlScan(scan)) {
    return {
      kind: "jsonl",
      lines: scan.count,
      precision: scan.precision,
    };
  }

  if (isLikelySse(text)) {
    return { kind: "sse" };
  }

  const lastChar = scan.precision === "exact" ? null : lastNonWhitespaceChar(text);
  const looksLikeJson =
    scan.precision === "exact"
      ? parses(text.trim())
      : (scan.firstNonWhitespace === "{" && lastChar === "}") ||
        (scan.firstNonWhitespace === "[" && lastChar === "]");
  return looksLikeJson ? { kind: "json" } : { kind: "invalid" };
};

export const detectSourceFormat = (text: string): SourceDetection =>
  detectSourceFormatInBudget(text, sourceDetectionProbeByteBudget);
