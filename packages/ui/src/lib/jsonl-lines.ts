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
  const firstNewline = chunk.indexOf("\n");
  if (firstNewline < 0) {
    const tail = buffer ? buffer + chunk : chunk;
    if (done && tail) {
      if (onLine(stripLineEndCarriageReturn(tail)) === false) {
        return { buffer: "", stopped: true };
      }

      return { buffer: "", stopped: false };
    }

    return { buffer: tail, stopped: false };
  }

  const firstLine = stripLineEndCarriageReturn(
    buffer ? buffer + chunk.slice(0, firstNewline) : chunk.slice(0, firstNewline),
  );
  if (onLine(firstLine) === false) {
    return { buffer: chunk.slice(firstNewline + 1), stopped: true };
  }

  let lineStart = firstNewline + 1;
  let newlineIndex = chunk.indexOf("\n", lineStart);
  while (newlineIndex >= 0) {
    const line = stripLineEndCarriageReturn(chunk.slice(lineStart, newlineIndex));
    if (onLine(line) === false) {
      return { buffer: chunk.slice(newlineIndex + 1), stopped: true };
    }

    lineStart = newlineIndex + 1;
    newlineIndex = chunk.indexOf("\n", lineStart);
  }

  const tail = chunk.slice(lineStart);
  if (done && tail) {
    if (onLine(stripLineEndCarriageReturn(tail)) === false) {
      return { buffer: "", stopped: true };
    }

    return { buffer: "", stopped: false };
  }

  return { buffer: tail, stopped: false };
};
