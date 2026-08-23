import { parseInput } from "@unquote/core";
import type { ParseOptions } from "@unquote/core";

export type ForcedFormat = NonNullable<ParseOptions["forcedFormat"]>;

export const parseTextResult = (input: string, forcedFormat?: ForcedFormat) =>
  parseInput(input, forcedFormat ? { forcedFormat } : {});
