import type {
  LosslessJsonArrayValue,
  LosslessJsonObjectValue,
  LosslessJsonValue,
  MaterializeOptions,
} from "./types.js";

const markerBase = "\0unquote:number";
const jsonNumberPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

interface JsonParseContext {
  source?: string;
}

type ContextualJsonParse = (
  input: string,
  reviver: (key: string, value: unknown, context?: JsonParseContext) => unknown,
) => unknown;

const contextualJsonParse: ContextualJsonParse = (input, reviver) =>
  (JSON.parse as ContextualJsonParse)(input, reviver);

const supportsJsonParseSource = (() => {
  let source: string | undefined;
  contextualJsonParse("0", (_key, value, context) => {
    source = context?.source;
    return value;
  });
  return source === "0";
})();

const escapedCharacter = (value: string, index: number) => {
  const escape = value[index + 1];
  if (escape === "u") {
    const hex = value.slice(index + 2, index + 6);
    return {
      character: String.fromCharCode(Number.parseInt(hex, 16)),
      nextIndex: index + 6,
    };
  }

  const characters: Record<string, string> = {
    '"': '"',
    "\\": "\\",
    "/": "/",
    b: "\b",
    f: "\f",
    n: "\n",
    r: "\r",
    t: "\t",
  };
  return {
    character: characters[escape ?? ""] ?? "",
    nextIndex: index + 2,
  };
};

const scanString = (input: string, start: number) => {
  let index = start + 1;
  let markerIndex = 0;
  let trackingMarker = true;
  let collisionColonCount = -1;

  while (index < input.length) {
    if (input[index] === '"') {
      return {
        end: index + 1,
        colonCount: collisionColonCount,
      };
    }

    const decoded =
      input[index] === "\\"
        ? escapedCharacter(input, index)
        : { character: input[index]!, nextIndex: index + 1 };
    index = decoded.nextIndex;

    if (!trackingMarker) {
      continue;
    }
    if (markerIndex < markerBase.length) {
      if (decoded.character !== markerBase[markerIndex]) {
        trackingMarker = false;
      } else {
        markerIndex += 1;
        if (markerIndex === markerBase.length) {
          collisionColonCount = 0;
        }
      }
      continue;
    }
    if (decoded.character === ":") {
      collisionColonCount += 1;
    } else {
      trackingMarker = false;
    }
  }

  return { end: input.length, colonCount: -1 };
};

const chooseNumberMarker = (input: string) => {
  let maxColonCount = -1;
  for (let index = 0; index < input.length; index += 1) {
    if (input[index] !== '"') {
      continue;
    }
    const scanned = scanString(input, index);
    maxColonCount = Math.max(maxColonCount, scanned.colonCount);
    index = scanned.end - 1;
  }
  return `${markerBase}${":".repeat(maxColonCount + 1)}`;
};

const scanNumberEnd = (input: string, start: number) => {
  let index = start;
  if (input[index] === "-") {
    index += 1;
  }

  if (input[index] === "0") {
    index += 1;
  } else {
    const integerStart = index;
    while (index < input.length && input[index]! >= "0" && input[index]! <= "9") {
      index += 1;
    }
    if (index === integerStart) {
      return start;
    }
  }

  if (input[index] === ".") {
    index += 1;
    while (index < input.length && input[index]! >= "0" && input[index]! <= "9") {
      index += 1;
    }
  }

  if (input[index] === "e" || input[index] === "E") {
    index += 1;
    if (input[index] === "+" || input[index] === "-") {
      index += 1;
    }
    while (index < input.length && input[index]! >= "0" && input[index]! <= "9") {
      index += 1;
    }
  }

  return jsonNumberPattern.test(input.slice(start, index)) ? index : start;
};

const replaceNumbers = (input: string, marker: string) => {
  const parts: string[] = [];
  let unchangedStart = 0;
  let replaced = false;

  for (let index = 0; index < input.length; index += 1) {
    if (input[index] === '"') {
      index = scanString(input, index).end - 1;
      continue;
    }

    const character = input[index]!;
    if (character !== "-" && (character < "0" || character > "9")) {
      continue;
    }

    const end = scanNumberEnd(input, index);
    if (end === index) {
      continue;
    }

    parts.push(
      input.slice(unchangedStart, index),
      JSON.stringify(`${marker}${input.slice(index, end)}`),
    );
    unchangedStart = end;
    index = end - 1;
    replaced = true;
  }

  if (!replaced) {
    return input;
  }
  parts.push(input.slice(unchangedStart));
  return parts.join("");
};

const primitiveValue = (value: unknown, marker: string): LosslessJsonValue => {
  if (typeof value === "string" && value.startsWith(marker)) {
    return { type: "number", rawValue: value.slice(marker.length) };
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  throw new TypeError(`Unsupported parsed JSON value: ${typeof value}`);
};

const toLosslessValue = (root: unknown, marker: string): LosslessJsonValue => {
  if (root === null || typeof root !== "object") {
    return primitiveValue(root, marker);
  }

  const converted = new WeakMap<object, LosslessJsonObjectValue | LosslessJsonArrayValue>();
  const pending: Array<{ value: object; visited: boolean }> = [{ value: root, visited: false }];

  while (pending.length > 0) {
    const current = pending.pop()!;
    if (!current.visited) {
      pending.push({ value: current.value, visited: true });
      for (const child of Object.values(current.value)) {
        if (child !== null && typeof child === "object") {
          pending.push({ value: child, visited: false });
        }
      }
      continue;
    }

    if (Array.isArray(current.value)) {
      const items = current.value.map((child) =>
        child !== null && typeof child === "object"
          ? converted.get(child)!
          : primitiveValue(child, marker),
      );
      converted.set(current.value, { type: "array", items });
      continue;
    }

    const entries = Object.fromEntries(
      Object.entries(current.value).map(([key, child]) => [
        key,
        child !== null && typeof child === "object"
          ? converted.get(child)!
          : primitiveValue(child, marker),
      ]),
    );
    converted.set(current.value, { type: "object", entries });
  }

  return converted.get(root)!;
};

export const parseLosslessJsonFallback = (input: string): LosslessJsonValue => {
  // Replacing numbers can turn invalid numeric object keys into valid strings.
  JSON.parse(input);
  const marker = chooseNumberMarker(input);
  const transformed = replaceNumbers(input, marker);
  return toLosslessValue(JSON.parse(transformed) as unknown, marker);
};

const parseWithSourceContext = (input: string) =>
  contextualJsonParse(input, (_key, value, context): LosslessJsonValue => {
    if (typeof value === "number") {
      if (!context?.source) {
        throw new TypeError("JSON.parse did not expose the number source");
      }
      return { type: "number", rawValue: context.source };
    }
    if (Array.isArray(value)) {
      return { type: "array", items: value as LosslessJsonValue[] };
    }
    if (value !== null && typeof value === "object") {
      return { type: "object", entries: value as Record<string, LosslessJsonValue> };
    }
    return value as string | boolean | null;
  }) as LosslessJsonValue;

export const parseLosslessJson = (input: string): LosslessJsonValue => {
  if (supportsJsonParseSource) {
    try {
      return parseWithSourceContext(input);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw error;
      }
      // Reviver traversal can exceed an engine's call stack for deeply nested
      // but valid JSON. The iterative fallback keeps maxDepth protection intact.
    }
  }
  return parseLosslessJsonFallback(input);
};

interface NormalizedDecimal {
  digits: string;
  exponent: number;
  negative: boolean;
}

const normalizeDecimal = (rawValue: string): NormalizedDecimal | null => {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(rawValue);
  if (!match) {
    return null;
  }

  const exponentText = (match[4] ?? "0").replace(/^([+-]?)0+(?=\d)/, "$1");
  if (exponentText.replace(/^[+-]/, "").length > 15) {
    return null;
  }

  const fraction = match[3] ?? "";
  let digits = `${match[2]}${fraction}`.replace(/^0+/, "");
  if (!digits) {
    return { digits: "0", exponent: 0, negative: false };
  }

  let exponent = Number(exponentText) - fraction.length;
  const trailingZeros = /0+$/.exec(digits)?.[0].length ?? 0;
  if (trailingZeros > 0) {
    digits = digits.slice(0, -trailingZeros);
    exponent += trailingZeros;
  }

  return { digits, exponent, negative: match[1] === "-" };
};

const isSafelyRepresented = (rawValue: string, value: number) => {
  if (!Number.isFinite(value)) {
    return false;
  }

  const source = normalizeDecimal(rawValue);
  if (!source) {
    return false;
  }
  if (source.exponent >= 0) {
    return Number.isSafeInteger(value);
  }

  const represented = normalizeDecimal(String(value));
  return (
    represented !== null &&
    source.digits === represented.digits &&
    source.exponent === represented.exponent &&
    source.negative === represented.negative
  );
};

export const validateJsonNumberLexeme = (rawValue: string) => {
  if (!jsonNumberPattern.test(rawValue)) {
    throw new TypeError(`Invalid JSON number lexeme: ${rawValue}`);
  }
  return rawValue;
};

export const materializeJsonNumber = (rawValue: string, options: MaterializeOptions = {}) => {
  validateJsonNumberLexeme(rawValue);
  const value = Number(rawValue);
  if (options.numbers === "approximate" || isSafelyRepresented(rawValue, value)) {
    return value;
  }

  throw new RangeError(
    `JSON number ${rawValue} cannot be represented safely as a JavaScript number; ` +
      'pass { numbers: "approximate" } to opt into rounding',
  );
};

const defineValue = (
  target: Record<string, unknown> | unknown[],
  key: string | number,
  value: unknown,
) => {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });
};

export const materializeLosslessValue = (
  root: LosslessJsonValue,
  options: MaterializeOptions = {},
): unknown => {
  let output: unknown;
  const pending: Array<{
    source: LosslessJsonValue;
    target: Record<string, unknown> | unknown[] | null;
    key: string | number;
  }> = [{ source: root, target: null, key: 0 }];

  while (pending.length > 0) {
    const { source, target, key } = pending.pop()!;
    const assign = (value: unknown) => {
      if (target) {
        defineValue(target, key, value);
      } else {
        output = value;
      }
    };
    if (source === null || typeof source === "string" || typeof source === "boolean") {
      assign(source);
      continue;
    }
    if (source.type === "number") {
      assign(materializeJsonNumber(source.rawValue, options));
      continue;
    }

    const container: Record<string, unknown> | unknown[] = source.type === "array" ? [] : {};
    assign(container);
    if (source.type === "array") {
      for (let index = source.items.length - 1; index >= 0; index -= 1) {
        pending.push({ source: source.items[index]!, target: container, key: index });
      }
      continue;
    }

    const keys = Object.keys(source.entries);
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const childKey = keys[index]!;
      pending.push({ source: source.entries[childKey]!, target: container, key: childKey });
    }
  }

  return output;
};
