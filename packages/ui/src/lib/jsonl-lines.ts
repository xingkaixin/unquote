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
  let lineStart = 0;
  let newlineIndex = chunk.indexOf("\n");
  let prefix = buffer;

  while (newlineIndex >= 0) {
    const slice = chunk.slice(lineStart, newlineIndex);
    const line = stripLineEndCarriageReturn(prefix ? prefix + slice : slice);
    prefix = "";
    if (onLine(line) === false) {
      return { buffer: chunk.slice(newlineIndex + 1), stopped: true };
    }

    lineStart = newlineIndex + 1;
    newlineIndex = chunk.indexOf("\n", lineStart);
  }

  const remainder = lineStart === 0 ? chunk : chunk.slice(lineStart);
  const tail = prefix ? prefix + remainder : remainder;
  if (done && tail) {
    return { buffer: "", stopped: onLine(stripLineEndCarriageReturn(tail)) === false };
  }

  return { buffer: tail, stopped: false };
};
