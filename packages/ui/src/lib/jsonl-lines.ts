export interface JsonlLineScanResult {
  buffer: string;
  stopped: boolean;
}

const stripLineEndCarriageReturn = (line: string) =>
  line.endsWith("\r") ? line.slice(0, -1) : line;

export const drainJsonlLines = (
  buffer: string,
  chunk: string,
  done: boolean,
  onLine: (line: string) => boolean | void,
): JsonlLineScanResult => {
  const text = buffer + chunk;
  let lineStart = 0;
  let newlineIndex = text.indexOf("\n", lineStart);

  while (newlineIndex >= 0) {
    const line = stripLineEndCarriageReturn(text.slice(lineStart, newlineIndex));
    if (onLine(line) === false) {
      return { buffer: text.slice(newlineIndex + 1), stopped: true };
    }

    lineStart = newlineIndex + 1;
    newlineIndex = text.indexOf("\n", lineStart);
  }

  const tail = text.slice(lineStart);
  if (done && tail) {
    if (onLine(stripLineEndCarriageReturn(tail)) === false) {
      return { buffer: "", stopped: true };
    }

    return { buffer: "", stopped: false };
  }

  return { buffer: tail, stopped: false };
};
