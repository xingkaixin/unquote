const isJsonWhitespaceCode = (code: number) =>
  code === 32 || code === 9 || code === 10 || code === 13;

const skipJsonWhitespace = (value: string, start: number) => {
  let index = start;
  const length = value.length;
  while (index < length && isJsonWhitespaceCode(value.charCodeAt(index))) {
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
  const length = value.length;

  if (value.charCodeAt(index) === 45) {
    index++;
  }

  if (value.charCodeAt(index) === 48) {
    index++;
  } else {
    const integerStart = index;
    while (index < length) {
      const code = value.charCodeAt(index);
      if (code < 48 || code > 57) {
        break;
      }
      index++;
    }
    if (index === integerStart) {
      return false;
    }
  }

  if (value.charCodeAt(index) === 46) {
    index++;
    const fractionStart = index;
    while (index < length) {
      const code = value.charCodeAt(index);
      if (code < 48 || code > 57) {
        break;
      }
      index++;
    }
    if (index === fractionStart) {
      return false;
    }
  }

  const exponentChar = value.charCodeAt(index);
  if (exponentChar === 101 || exponentChar === 69) {
    index++;
    const signChar = value.charCodeAt(index);
    if (signChar === 43 || signChar === 45) {
      index++;
    }
    const exponentStart = index;
    while (index < length) {
      const code = value.charCodeAt(index);
      if (code < 48 || code > 57) {
        break;
      }
      index++;
    }
    if (index === exponentStart) {
      return false;
    }
  }

  return hasOnlyTrailingJsonWhitespace(value, index);
};

const skipTrailingJsonWhitespace = (value: string, start: number) => {
  let index = value.length - 1;
  while (index >= start && isJsonWhitespaceCode(value.charCodeAt(index))) {
    index--;
  }
  return index;
};

export const mightBeStringifiedJson = (value: string) => {
  const length = value.length;
  if (length === 0) {
    return false;
  }
  const start = skipJsonWhitespace(value, 0);
  if (start >= length) {
    return false;
  }
  const first = value.charCodeAt(start);

  if (first === 123 || first === 91 || first === 34) {
    const end = skipTrailingJsonWhitespace(value, start);
    if (end <= start) {
      return false;
    }
    const last = value.charCodeAt(end);
    return (
      (first === 123 && last === 125) ||
      (first === 91 && last === 93) ||
      (first === 34 && last === 34)
    );
  }
  if (first === 116) {
    return hasJsonLiteral(value, start, "true");
  }
  if (first === 102) {
    return hasJsonLiteral(value, start, "false");
  }
  if (first === 110) {
    return hasJsonLiteral(value, start, "null");
  }
  return first === 45 || (first >= 48 && first <= 57) ? hasJsonNumber(value, start) : false;
};

export const fastTrim = (value: string) => {
  const length = value.length;
  if (length === 0) {
    return "";
  }
  const first = value.charCodeAt(0);
  const last = value.charCodeAt(length - 1);
  if (first > 32 && first < 127 && last > 32 && last < 127) {
    return value;
  }
  return value.trim();
};

export const isStringifiedJson = (value: string) => {
  const trimmed = fastTrim(value);
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
