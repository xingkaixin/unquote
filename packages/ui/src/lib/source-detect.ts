export type SourceDetection =
  | { kind: "empty" }
  | { kind: "json" }
  | { kind: "jsonl"; lines: number }
  | { kind: "invalid" };

// The draft is re-sniffed on every keystroke, so nothing longer than this
// budget is ever parsed: the probe walks whole lines until it has spent the
// budget, across no more than this many lines, and falls back to a shape check
// for any candidate that exceeds it on its own.
const probeBudget = 64 * 1024;
const probedLines = 40;

const parses = (text: string) => {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
};

const isBracketed = (text: string) => {
  const last = text.at(-1);
  return (text[0] === "{" && last === "}") || (text[0] === "[" && last === "]");
};

const looksLikeJson = (text: string) =>
  text.length > probeBudget ? isBracketed(text) : parses(text);

const probeJsonLines = (lines: readonly string[]) => {
  let budget = probeBudget;
  for (const line of lines.slice(0, probedLines)) {
    if (!looksLikeJson(line)) {
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

  return looksLikeJson(trimmed) ? { kind: "json" } : { kind: "invalid" };
};
