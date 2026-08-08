export type SourceDetection =
  | { kind: "empty" }
  | { kind: "json" }
  | { kind: "jsonl"; lines: number; precision: "exact" | "lower-bound" }
  | { kind: "invalid" };

export const sourceDetectionProbeByteBudget = 64 * 1024;
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
}

const trimLine = (text: string, start: number, end: number) => {
  while (start < end && text.charCodeAt(start) <= 32) {
    start += 1;
  }
  while (end > start && text.charCodeAt(end - 1) <= 32) {
    end -= 1;
  }
  return { start, end };
};

const scanLines = (text: string): DraftLines => {
  const probe: string[] = [];
  let count = 0;
  let bytes = 0;
  let index = 0;
  let lineStart = 0;
  let firstNonWhitespace: string | null = null;

  const collectLine = (end: number, complete: boolean) => {
    const trimmed = trimLine(text, lineStart, end);
    if (trimmed.start < trimmed.end) {
      count += 1;
      if (complete) {
        probe.push(text.slice(trimmed.start, trimmed.end));
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

    if (bytes + byteWidth > sourceDetectionProbeByteBudget) {
      break;
    }

    if (firstNonWhitespace === null && code > 32) {
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
    return { count, precision: "exact", probe, firstNonWhitespace };
  }

  collectLine(index, false);
  return { count, precision: "lower-bound", probe, firstNonWhitespace };
};

export const detectSourceFormat = (text: string): SourceDetection => {
  const scan = scanLines(text);
  if (scan.count === 0 && scan.precision === "exact") {
    return { kind: "empty" };
  }

  if (scan.count > 1 && scan.probe.length > 1 && scan.probe.every(parses)) {
    return {
      kind: "jsonl",
      lines: scan.count,
      precision: scan.precision,
    };
  }

  const looksLikeJson =
    scan.precision === "exact"
      ? parses(text.trim())
      : (scan.firstNonWhitespace === "{" && text.at(-1) === "}") ||
        (scan.firstNonWhitespace === "[" && text.at(-1) === "]");
  return looksLikeJson ? { kind: "json" } : { kind: "invalid" };
};
