const isJsonWhitespace = (character: string) =>
  character === " " || character === "\t" || character === "\n" || character === "\r";

const skipJsonWhitespace = (value: string, start: number) => {
  let index = start;
  while (index < value.length && isJsonWhitespace(value[index]!)) {
    index++;
  }
  return index;
};

const hasOnlyTrailingJsonWhitespace = (value: string, start: number) =>
  skipJsonWhitespace(value, start) === value.length;

const hasJsonLiteral = (value: string, start: number, literal: string) =>
  value.startsWith(literal, start) && hasOnlyTrailingJsonWhitespace(value, start + literal.length);

const hasJsonNumber = (value: string, start: number) => {
  let index = start;

  if (value[index] === "-") {
    index++;
  }

  if (value[index] === "0") {
    index++;
  } else {
    const integerStart = index;
    while (index < value.length && value[index]! >= "0" && value[index]! <= "9") {
      index++;
    }
    if (index === integerStart) {
      return false;
    }
  }

  if (value[index] === ".") {
    index++;
    const fractionStart = index;
    while (index < value.length && value[index]! >= "0" && value[index]! <= "9") {
      index++;
    }
    if (index === fractionStart) {
      return false;
    }
  }

  if (value[index] === "e" || value[index] === "E") {
    index++;
    if (value[index] === "+" || value[index] === "-") {
      index++;
    }
    const exponentStart = index;
    while (index < value.length && value[index]! >= "0" && value[index]! <= "9") {
      index++;
    }
    if (index === exponentStart) {
      return false;
    }
  }

  return hasOnlyTrailingJsonWhitespace(value, index);
};

export const mightBeStringifiedJson = (value: string) => {
  const start = skipJsonWhitespace(value, 0);
  const first = value[start];

  if (first === "{" || first === "[" || first === '"') {
    return true;
  }
  if (first === "t") {
    return hasJsonLiteral(value, start, "true");
  }
  if (first === "f") {
    return hasJsonLiteral(value, start, "false");
  }
  if (first === "n") {
    return hasJsonLiteral(value, start, "null");
  }
  return first === "-" || (first !== undefined && first >= "0" && first <= "9")
    ? hasJsonNumber(value, start)
    : false;
};

export const isStringifiedJson = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed || !mightBeStringifiedJson(trimmed)) {
    return false;
  }

  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
};
