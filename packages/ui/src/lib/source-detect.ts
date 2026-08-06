export type SourceDetection =
  | { kind: "empty" }
  | { kind: "json" }
  | { kind: "jsonl"; lines: number }
  | { kind: "invalid" };

// The draft is re-sniffed on every keystroke, so the scan below allocates
// nothing per line and parses at most this budget plus the one line that
// crosses it; any candidate longer than the budget is judged by its shape.
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

interface DraftLines {
  count: number;
  probe: string[];
}

const scanLines = (text: string): DraftLines => {
  const probe: string[] = [];
  let count = 0;
  let budget = probeBudget;
  let index = 0;

  for (;;) {
    const brk = text.indexOf("\n", index);
    const end = brk === -1 ? text.length : brk;
    let start = index;
    while (start < end && text.charCodeAt(start) <= 32) {
      start += 1;
    }

    let stop = end;
    while (stop > start && text.charCodeAt(stop - 1) <= 32) {
      stop -= 1;
    }

    if (start < stop) {
      count += 1;
      if (probe.length < probedLines && budget > 0) {
        budget -= stop - start;
        probe.push(text.slice(start, stop));
      }
    }

    if (brk === -1) {
      return { count, probe };
    }

    index = brk + 1;
  }
};

export const detectSourceFormat = (text: string): SourceDetection => {
  const { count, probe } = scanLines(text);
  if (count === 0) {
    return { kind: "empty" };
  }

  if (count > 1 && probe.every((line) => looksLikeJson(line))) {
    return { kind: "jsonl", lines: count };
  }

  return looksLikeJson(text.trim()) ? { kind: "json" } : { kind: "invalid" };
};
