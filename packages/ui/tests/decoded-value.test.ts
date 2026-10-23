import { parseInput } from "@unquote/core";
import type { JsonNode } from "@unquote/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeNodeValue, jwtCharLimit } from "../src/lib/decoded-value";

const originalTimeZone = process.env["TZ"];

beforeAll(() => {
  process.env["TZ"] = "America/New_York";
});

afterAll(() => {
  process.env["TZ"] = originalTimeZone;
});

const nodeOf = (json: string): JsonNode => {
  const record = parseInput(json, { forcedFormat: "json" }).records[0];
  if (record?.status !== "full") {
    throw new Error(`Invalid test JSON: ${json}`);
  }
  return record.node;
};

const stringNode = (value: string) => nodeOf(JSON.stringify(value));

const segment = (text: string) => Buffer.from(text).toString("base64url");

const jwt = (header: string, payload: string, signature = "c2lnbmF0dXJl") =>
  `${segment(header)}.${segment(payload)}.${signature}`;

describe("decodeNodeValue JWT detection", () => {
  it("decodes the header and payload of a signed token", () => {
    const token = jwt('{"alg":"HS256","typ":"JWT"}', '{"sub":"1234567890","iat":1516239022}');

    expect(decodeNodeValue(stringNode(token))).toEqual({
      kind: "jwt",
      header: '{\n  "alg": "HS256",\n  "typ": "JWT"\n}',
      payload: '{\n  "sub": "1234567890",\n  "iat": 1516239022\n}',
    });
  });

  it("keeps payload number lexemes, UTF-8 text, and stringified JSON as written", () => {
    const token = jwt(
      '{"alg":"RS256"}',
      '{"id":12345678901234567890,"name":"名前","raw":"{\\"a\\":1}"}',
    );

    expect(decodeNodeValue(stringNode(token))).toMatchObject({
      payload: '{\n  "id": 12345678901234567890,\n  "name": "名前",\n  "raw": "{\\"a\\":1}"\n}',
    });
  });

  it("accepts an unsecured token with an empty signature", () => {
    const token = jwt('{"alg":"none"}', '{"sub":"a"}', "");

    expect(decodeNodeValue(stringNode(token))).toMatchObject({ kind: "jwt" });
  });

  it.each([
    ["a header without alg", jwt('{"typ":"JWT"}', '{"sub":"a"}')],
    ["a non-string alg", jwt('{"alg":1}', '{"sub":"a"}')],
    ["an array header", jwt('["alg"]', '{"sub":"a"}')],
    ["a payload that is not JSON", jwt('{"alg":"HS256"}', "not json")],
    ["a payload that is not an object", jwt('{"alg":"HS256"}', "[1]")],
    ["a header that is not JSON", jwt("alg", '{"sub":"a"}')],
    ["two segments", `${segment('{"alg":"HS256"}')}.${segment('{"sub":"a"}')}`],
    ["four segments", `${jwt('{"alg":"HS256"}', '{"sub":"a"}')}.extra`],
    ["padded base64", `${Buffer.from('{"alg":"none"}').toString("base64")}.e30.sig`],
    ["an impossible base64 length", `${segment('{"alg":"HS256"}')}x.e30.sig`],
    ["invalid UTF-8", `${Buffer.from([0xff, 0xfe]).toString("base64url")}.e30.sig`],
    ["generic base64", Buffer.from('{"alg":"HS256"}').toString("base64url")],
    ["a version string", "1.2.3"],
    ["a host name", "api.example.com"],
  ])("rejects %s", (_name, value) => {
    expect(decodeNodeValue(stringNode(value))).toBeNull();
  });

  it("rejects a token longer than the decoding limit", () => {
    const token = jwt('{"alg":"HS256"}', JSON.stringify({ pad: "x".repeat(jwtCharLimit) }));

    expect(decodeNodeValue(stringNode(token))).toBeNull();
  });
});

describe("decodeNodeValue timestamp detection", () => {
  it("reads 9-10 digit integers in range as Unix seconds", () => {
    expect(decodeNodeValue(nodeOf("1700000000"))).toEqual({
      kind: "timestamp",
      source: "unix-seconds",
      local: "2023-11-14T17:13:20-05:00",
      utc: "2023-11-14T22:13:20Z",
      timeZone: "America/New_York",
    });
  });

  it("reads 12-13 digit integers in range as Unix milliseconds", () => {
    expect(decodeNodeValue(nodeOf("1720000000123"))).toEqual({
      kind: "timestamp",
      source: "unix-milliseconds",
      local: "2024-07-03T05:46:40.123-04:00",
      utc: "2024-07-03T09:46:40.123Z",
      timeZone: "America/New_York",
    });
  });

  it.each([
    ["946684800", "2000-01-01T00:00:00Z"],
    ["4102444799", "2099-12-31T23:59:59Z"],
    ["946684800000", "2000-01-01T00:00:00.000Z"],
    ["4102444799999", "2099-12-31T23:59:59.999Z"],
  ])("includes the range boundary %s", (lexeme, utc) => {
    expect(decodeNodeValue(nodeOf(lexeme))).toMatchObject({ utc });
  });

  it.each([
    ["the second before 2000", "946684799"],
    ["2100 in seconds", "4102444800"],
    ["the millisecond before 2000", "946684799999"],
    ["2100 in milliseconds", "4102444800000"],
    ["zero", "0"],
    ["a small count", "42"],
    ["a compact date", "20240101"],
    ["an 11 digit integer", "17000000000"],
    ["a negative integer", "-1700000000"],
    ["a fraction", "1700000000.5"],
    ["a trailing zero fraction", "1700000000.0"],
    ["an exponent", "1.7e9"],
    ["a lexeme that rounds into range", "946684799.99999999999"],
    ["an unsafe integer", "17000000000000000000"],
  ])("rejects %s", (_name, lexeme) => {
    expect(decodeNodeValue(nodeOf(lexeme))).toBeNull();
  });

  it("does not read numeric strings as epochs", () => {
    expect(decodeNodeValue(stringNode("1700000000"))).toBeNull();
    expect(decodeNodeValue(stringNode("1700000000000"))).toBeNull();
  });

  it("converts an ISO 8601 offset and keeps its fraction digits", () => {
    expect(decodeNodeValue(stringNode("2023-11-15T06:13:20.123456+08:00"))).toEqual({
      kind: "timestamp",
      source: "iso-8601",
      local: "2023-11-14T17:13:20.123456-05:00",
      utc: "2023-11-14T22:13:20.123456Z",
      timeZone: "America/New_York",
    });
  });

  it.each([
    ["2024-02-29T12:00:00-05:30", "2024-02-29T17:30:00Z"],
    ["2023-11-14T22:13:20Z", "2023-11-14T22:13:20Z"],
    ["0099-01-01T00:00:00Z", "0099-01-01T00:00:00Z"],
  ])("decodes %s", (value, utc) => {
    expect(decodeNodeValue(stringNode(value))).toMatchObject({ utc });
  });

  it.each([
    ["a date without a time", "2023-11-14"],
    ["a time without an offset", "2023-11-14T22:13:20"],
    ["a space separator", "2023-11-14 22:13:20Z"],
    ["missing seconds", "2023-11-14T22:13Z"],
    ["a compact offset", "2023-11-14T22:13:20+0800"],
    ["a non-leap February 29", "2023-02-29T00:00:00Z"],
    ["month 13", "2023-13-01T00:00:00Z"],
    ["hour 24", "2023-11-14T24:00:00Z"],
    ["a leap second", "2023-12-31T23:59:60Z"],
    ["an offset hour of 24", "2023-11-14T22:13:20+24:00"],
    ["trailing text", "2023-11-14T22:13:20Z done"],
  ])("rejects %s", (_name, value) => {
    expect(decodeNodeValue(stringNode(value))).toBeNull();
  });

  it("ignores containers and other scalars", () => {
    expect(decodeNodeValue(nodeOf('{"iat":1700000000}'))).toBeNull();
    expect(decodeNodeValue(nodeOf("[1700000000]"))).toBeNull();
    expect(decodeNodeValue(nodeOf("true"))).toBeNull();
    expect(decodeNodeValue(nodeOf("null"))).toBeNull();
  });
});
