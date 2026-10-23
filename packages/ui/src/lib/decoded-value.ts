import type { JsonNode } from "@unquote/core";
import { isFullRecord, parseInput, stringifyJsonNode } from "@unquote/core";

export const jwtCharLimit = 20_000;

export type TimestampSource = "unix-seconds" | "unix-milliseconds" | "iso-8601";

export type DecodedValue =
  | { kind: "jwt"; header: string; payload: string }
  | { kind: "timestamp"; source: TimestampSource; local: string; utc: string; timeZone: string };

const jwtPattern = /^([\w-]+)\.([\w-]+)\.([\w-]*)$/;

// Unix seconds of 2000-01-01T00:00:00Z (inclusive) and 2100-01-01T00:00:00Z (exclusive).
const epochSeconds = { min: 946_684_800, max: 4_102_444_800 };

const epochIntegerPattern = /^[1-9]\d{8,12}$/;

const isoPattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?:Z|([+-])(\d{2}):(\d{2}))$/;

const utf8 = new TextDecoder("utf-8", { fatal: true });

const decodeBase64Url = (segment: string) => {
  if (segment.length % 4 === 1) {
    return null;
  }
  const binary = atob(segment.replaceAll("-", "+").replaceAll("_", "/"));
  try {
    return utf8.decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  } catch {
    return null;
  }
};

// maxDepth 0 keeps the segment as one lossless value, so claims holding JSON text stay as written.
const parseSegmentObject = (segment: string) => {
  const text = decodeBase64Url(segment);
  if (text === null) {
    return null;
  }
  const record = parseInput(text, { forcedFormat: "json", maxDepth: 0 }).records[0];
  const node = record && isFullRecord(record) ? record.node : null;
  return node?.kind === "object" ? node : null;
};

const decodeJwt = (value: string): DecodedValue | null => {
  const match = value.length <= jwtCharLimit ? jwtPattern.exec(value) : null;
  if (!match) {
    return null;
  }
  const header = parseSegmentObject(match[1]!);
  if (typeof header?.value?.entries["alg"] !== "string") {
    return null;
  }
  const payload = parseSegmentObject(match[2]!);
  return payload
    ? {
        kind: "jwt",
        header: stringifyJsonNode(header, { indent: 2 }),
        payload: stringifyJsonNode(payload, { indent: 2 }),
      }
    : null;
};

const pad = (value: number, length = 2) => String(value).padStart(length, "0");

const formatWallTime = (epochMs: number, fraction: string, offsetMinutes: number) => {
  const wall = new Date(epochMs + offsetMinutes * 60_000);
  const date = `${pad(wall.getUTCFullYear(), 4)}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}`;
  const time = `${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}:${pad(wall.getUTCSeconds())}`;
  return `${date}T${time}${fraction ? `.${fraction}` : ""}`;
};

const formatOffset = (offsetMinutes: number) => {
  const magnitude = Math.abs(offsetMinutes);
  return `${offsetMinutes < 0 ? "-" : "+"}${pad(Math.floor(magnitude / 60))}:${pad(magnitude % 60)}`;
};

const timestampOf = (source: TimestampSource, epochMs: number, fraction: string): DecodedValue => {
  // Historical zones can have second-level offsets; rounding keeps the shown wall time and
  // offset consistent with the same instant.
  const localOffset = Math.round(-new Date(epochMs).getTimezoneOffset());
  return {
    kind: "timestamp",
    source,
    local: formatWallTime(epochMs, fraction, localOffset) + formatOffset(localOffset),
    utc: `${formatWallTime(epochMs, fraction, 0)}Z`,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
};

const decodeEpoch = (lexeme: string): DecodedValue | null => {
  if (!epochIntegerPattern.test(lexeme)) {
    return null;
  }
  const value = Number(lexeme);
  if (value >= epochSeconds.min && value < epochSeconds.max) {
    return timestampOf("unix-seconds", value * 1000, "");
  }
  if (value >= epochSeconds.min * 1000 && value < epochSeconds.max * 1000) {
    return timestampOf("unix-milliseconds", value, lexeme.slice(-3));
  }
  return null;
};

const decodeIsoTimestamp = (value: string): DecodedValue | null => {
  const match = isoPattern.exec(value);
  if (!match) {
    return null;
  }
  const field = (group: number) => Number(match[group] ?? 0);
  const [year, month, day] = [field(1), field(2), field(3)];
  const [hour, minute, second] = [field(4), field(5), field(6)];
  const [offsetHours, offsetMinutes] = [field(9), field(10)];
  if (hour > 23 || minute > 59 || second > 59 || offsetHours > 23 || offsetMinutes > 59) {
    return null;
  }

  // setUTCFullYear avoids Date.UTC mapping years 0-99 to 1900-1999.
  const wall = new Date(0);
  wall.setUTCFullYear(year, month - 1, day);
  if (wall.getUTCFullYear() !== year || wall.getUTCMonth() !== month - 1) {
    return null;
  }
  wall.setUTCHours(hour, minute, second);
  const offsetSign = match[8] === "-" ? -1 : 1;
  const epochMs = wall.getTime() - offsetSign * (offsetHours * 60 + offsetMinutes) * 60_000;
  return timestampOf("iso-8601", epochMs, match[7] ?? "");
};

export const decodeNodeValue = (node: JsonNode): DecodedValue | null => {
  if (node.rawString !== undefined) {
    return null;
  }
  if (node.kind === "number") {
    return decodeEpoch(node.rawValue ?? String(node.value));
  }
  if (node.kind === "string") {
    return decodeJwt(node.value) ?? decodeIsoTimestamp(node.value);
  }
  return null;
};
