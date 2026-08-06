export type SourceDetection =
  | { kind: "empty" }
  | { kind: "json" }
  | { kind: "jsonl"; lines: number }
  | { kind: "invalid" };

// The draft is re-sniffed on every keystroke, so only the head of a large paste
// is sampled and only the first few lines of it are actually parsed.
const sampleLength = 64 * 1024;
const probedLines = 40;

const parses = (line: string) => {
  try {
    JSON.parse(line);
    return true;
  } catch {
    return false;
  }
};

export const detectSourceFormat = (text: string): SourceDetection => {
  const trimmed = text.trim();
  if (!trimmed) {
    return { kind: "empty" };
  }

  const lines = trimmed
    .slice(0, sampleLength)
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length > 1 && lines.slice(0, probedLines).every(parses)) {
    return { kind: "jsonl", lines: lines.length };
  }

  return parses(trimmed) ? { kind: "json" } : { kind: "invalid" };
};
