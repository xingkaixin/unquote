import type { ParseErrorMeta } from "./types.js";
import { truncateAtCodePointBoundary } from "./utils.js";

interface SourceLineBounds {
  readonly number: number;
  readonly start: number;
  readonly end: number;
}

interface SourceLocation {
  readonly line: number;
  readonly column: number;
  readonly rawLine: string;
  readonly contextLines: readonly SourceLineBounds[];
}

const contextLineLength = 160;
const contextLineRadius = 80;

export const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Unknown parse error";

const getMessagePosition = (message: string) => {
  const match = /position\s+(\d+)/i.exec(message);
  return match ? Number(match[1]) : null;
};

const getUnexpectedTokenPosition = (input: string, message: string) => {
  const match = /Unexpected token '([^']+)'/i.exec(message);
  const token = match?.[1];
  if (!token) {
    return null;
  }

  const index = input.indexOf(token);
  if (index < 0) {
    return null;
  }

  // The token text can occur earlier in the input than the actual failure (e.g. inside
  // a string value), so only trust this fallback when the token is unambiguous.
  return index === input.lastIndexOf(token) ? index : null;
};

const getMessageLineColumn = (message: string) => {
  const match = /line\s+(\d+)\s+column\s+(\d+)/i.exec(message);
  if (!match) {
    return null;
  }

  return {
    line: Number(match[1]),
    column: Number(match[2]),
  };
};

const lineBounds = (input: string, number: number, start: number, newline: number) => ({
  number,
  start,
  end:
    newline < input.length && newline > start && input.charCodeAt(newline - 1) === 13
      ? newline - 1
      : newline,
});

const scanSourceLocation = (
  input: string,
  messageLocation: { line: number; column: number } | null,
  position: number,
): SourceLocation => {
  const safePosition = Math.max(0, Math.min(position, input.length));
  let targetLine = messageLocation?.line;
  let targetColumn = messageLocation?.column;
  let lineNumber = 1;
  let lineStart = 0;
  let previousLine: SourceLineBounds | null = null;
  let foundTarget = false;
  let rawLine = "";
  const contextLines: SourceLineBounds[] = [];

  for (let index = 0; index <= input.length; index += 1) {
    const atEnd = index === input.length;
    if (!atEnd && input.charCodeAt(index) !== 10) {
      continue;
    }

    const currentLine = lineBounds(input, lineNumber, lineStart, index);
    if (targetLine === undefined && safePosition <= index) {
      targetLine = lineNumber;
      targetColumn = safePosition - lineStart + 1;
    }

    if (lineNumber === targetLine) {
      if (previousLine) {
        contextLines.push(previousLine);
      }
      contextLines.push(currentLine);
      rawLine = input.slice(currentLine.start, currentLine.end);
      foundTarget = true;
    } else if (foundTarget && targetLine !== undefined && lineNumber === targetLine + 1) {
      contextLines.push(currentLine);
    }

    previousLine = currentLine;
    if (!atEnd) {
      lineNumber += 1;
      lineStart = index + 1;
    }
  }

  return {
    line: targetLine ?? lineNumber,
    column: targetColumn ?? 1,
    rawLine,
    contextLines,
  };
};

const getContextLine = (line: string, column?: number) => {
  if (line.length <= contextLineLength) {
    return { text: line, column };
  }

  if (typeof column !== "number") {
    return {
      text: `${truncateAtCodePointBoundary(line, contextLineLength - 3)}...`,
      column,
    };
  }

  const zeroColumn = Math.max(0, column - 1);
  const initialStart = Math.min(
    Math.max(0, zeroColumn - contextLineRadius),
    Math.max(0, line.length - contextLineLength),
  );
  const startsInsideSurrogatePair =
    initialStart > 0 && (line.codePointAt(initialStart - 1) ?? 0) > 0xffff;
  const start = startsInsideSurrogatePair ? initialStart + 1 : initialStart;
  const visibleLine = truncateAtCodePointBoundary(
    line.slice(start, start + contextLineLength + 1),
    contextLineLength,
  );
  const end = start + visibleLine.length;
  const prefix = start > 0 ? "..." : "";
  const suffix = end < line.length ? "..." : "";

  return {
    text: `${prefix}${visibleLine}${suffix}`,
    column: column - start + prefix.length,
  };
};

const getErrorContext = (input: string, location: SourceLocation, lineOffset: number) => {
  const finalLine = location.contextLines.at(-1)?.number ?? location.line;
  const numberWidth = String(finalLine + lineOffset).length;
  const context: string[] = [];

  for (const sourceLine of location.contextLines) {
    const displayLine = sourceLine.number + lineOffset;
    const column = sourceLine.number === location.line ? location.column : undefined;
    const line = input.slice(sourceLine.start, sourceLine.end);
    const snippet = getContextLine(line, column);
    context.push(`${String(displayLine).padStart(numberWidth, " ")} | ${snippet.text}`);

    if (sourceLine.number === location.line) {
      context.push(
        `${" ".repeat(numberWidth)} | ${" ".repeat(Math.max(0, (snippet.column ?? location.column) - 1))}^`,
      );
    }
  }

  return context.join("\n");
};

export const getParseErrorMeta = (
  input: string,
  error: unknown,
  lineOffset = 0,
): ParseErrorMeta => {
  const message = getErrorMessage(error);
  const messageLocation = getMessageLineColumn(message);
  const position =
    getMessagePosition(message) ?? getUnexpectedTokenPosition(input, message) ?? input.length;
  const location = scanSourceLocation(input, messageLocation, position);

  return {
    line: location.line + lineOffset,
    column: location.column,
    rawLine: location.rawLine,
    context: getErrorContext(input, location, lineOffset),
  };
};
