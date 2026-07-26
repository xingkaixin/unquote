import type {
  FailedJsonlRecord,
  FullJsonlRecord,
  JsonlRecord,
  ParsedJsonlRecord,
  PreviewJsonlRecord,
} from "./types.js";

export const isParsed = (record: JsonlRecord): record is ParsedJsonlRecord =>
  record.status !== "failed";

export const isFullRecord = (record: JsonlRecord): record is FullJsonlRecord =>
  record.status === "full";

export const isPreviewRecord = (record: JsonlRecord): record is PreviewJsonlRecord =>
  record.status === "preview";

export const isFailedRecord = (record: JsonlRecord): record is FailedJsonlRecord =>
  record.status === "failed";
