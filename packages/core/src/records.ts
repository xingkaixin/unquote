import type { JsonlRecord } from "./types.js";

export const isParsed = (record: JsonlRecord) => Boolean(record.node || record.deferred);
