import type { JsonlRecord } from "@unquote/core";

export const resolveHydratedRecord = (
  record: JsonlRecord,
  hydratedRecords: ReadonlyMap<number, JsonlRecord>,
) => hydratedRecords.get(record.lineNumber) ?? record;
