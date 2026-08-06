export type SourceDetection =
  | { kind: "empty" }
  | { kind: "json" }
  | { kind: "jsonl"; lines: number }
  | { kind: "invalid" };

// The draft is re-sniffed on every keystroke, so the JSONL probe parses whole
// lines only until it has spent this budget, and never more than this many.
const probeBudget = 64 * 1024;
const probedLines = 40;

const parses = (line: string) => {
  try {
    JSON.parse(line);
    return true;
  } catch {
    return false;
  }
};

const probeJsonLines = (lines: readonly string[]) => {
  let budget = probeBudget;
  for (const line of lines.slice(0, probedLines)) {
    if (!parses(line)) {
      return false;
    }

    budget -= line.length;
    if (budget <= 0) {
      break;
    }
  }

  return true;
};

export const detectSourceFormat = (text: string): SourceDetection => {
  const trimmed = text.trim();
  if (!trimmed) {
    return { kind: "empty" };
  }

  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length > 1 && probeJsonLines(lines)) {
    return { kind: "jsonl", lines: lines.length };
  }

  return parses(trimmed) ? { kind: "json" } : { kind: "invalid" };
};
