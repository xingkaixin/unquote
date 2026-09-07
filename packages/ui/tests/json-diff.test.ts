import { describe, expect, it } from "vitest";
import { parseJsonlRecordLine } from "@unquote/core";
import { compareJsonNodes, formatDiffInput, parseIgnoredPaths } from "../src/lib/json-diff";

const node = (text: string) => {
  const record = parseJsonlRecordLine(text, 1);
  if (record.status !== "full") throw new Error("fixture");
  return record.node;
};

describe("structured JSON comparison", () => {
  it("ignores key order and compares inside stringified objects", async () => {
    expect(await compareJsonNodes(node('{"b":2,"a":1}'), node('{"a":1,"b":2}'))).toEqual([]);
    const changes = await compareJsonNodes(
      node(JSON.stringify({ body: JSON.stringify({ id: 1 }) })),
      node('{"body":{"id":2}}'),
    );
    expect(changes).toEqual([
      {
        path: "$.body.id",
        kind: "changed",
        before: { text: "1", truncated: false },
        after: { text: "2", truncated: false },
      },
    ]);
  });
  it("preserves numeric spelling, large integers, missing values and types", async () => {
    const changes = await compareJsonNodes(
      node('{"id":9007199254740992,"n":1.0,"gone":null}'),
      node('{"id":9007199254740993,"n":"one","added":null}'),
    );
    expect(changes.map(({ path, kind }) => [path, kind])).toEqual([
      ["$.id", "changed"],
      ["$.n", "type"],
      ["$.gone", "removed"],
      ["$.added", "added"],
    ]);
    expect(changes[0]?.after.text).toBe("9007199254740993");
    expect(changes[1]?.before.text).toBe("1.0");
  });
  it("compares arrays by position and ignores only exact path subtrees", async () => {
    expect(
      (await compareJsonNodes(node("[1,2]"), node("[0,1,2]"))).map(({ kind }) => kind),
    ).toEqual(["changed", "changed", "added"]);
    expect(
      (
        await compareJsonNodes(
          node('{"a":{"x":1},"ab":1}'),
          node('{"a":{"x":2},"ab":2}'),
          parseIgnoredPaths(".a"),
        )
      ).map(({ path }) => path),
    ).toEqual(["$.ab"]);
    expect(() => parseIgnoredPaths("timestamp")).toThrow();
  });
  it("handles unusual own keys and refuses incomplete or over-budget comparisons", async () => {
    expect(
      (
        await compareJsonNodes(node('{"__proto__":1,"a.b":1}'), node('{"__proto__":2,"a.b":2}'))
      ).map(({ path }) => path),
    ).toEqual(["$.__proto__", '$["a.b"]']);
    expect(() => formatDiffInput(node(JSON.stringify("x".repeat(600_000))))).toThrow(RangeError);
    await expect(
      compareJsonNodes({ kind: "object", preview: true, childCount: 1 }, node("{}")),
    ).rejects.toThrow(RangeError);
    const controller = new AbortController();
    controller.abort();
    await expect(compareJsonNodes(node("{}"), node("{}"), [], controller.signal)).rejects.toThrow();
  });
});

it("shows the first differing part of long scalar values instead of identical prefixes", async () => {
  const prefix = "x".repeat(1200);
  const [change] = await compareJsonNodes(
    node(JSON.stringify(prefix + "A")),
    node(JSON.stringify(prefix + "B")),
  );
  expect(change?.before.text).toContain('A"');
  expect(change?.after.text).toContain('B"');
  expect(change?.before.truncated).toBe(true);
  expect(change?.after.truncated).toBe(true);
  expect(change?.before.text.length).toBeLessThanOrEqual(1002);
});

it("keeps Unicode intact in excerpts and shows differences after escaped content", async () => {
  const prefix = "😀\n".repeat(400);
  const [change] = await compareJsonNodes(
    node(JSON.stringify(prefix + "😀" + prefix)),
    node(JSON.stringify(prefix + "😁" + prefix)),
  );
  expect(change?.before.text).toContain("😀");
  expect(change?.after.text).toContain("😁");
  expect(() => encodeURI(change!.before.text)).not.toThrow();
  expect(() => encodeURI(change!.after.text)).not.toThrow();
  expect(change?.before.text.length).toBeLessThanOrEqual(1002);
});

it("marks truncated added, removed and type-changed values explicitly", async () => {
  const value = "x".repeat(1200);
  const changes = await compareJsonNodes(
    node(JSON.stringify({ removed: value, type: value })),
    node(JSON.stringify({ added: value, type: 1 })),
  );
  expect(changes.find((change) => change.kind === "added")?.after.truncated).toBe(true);
  expect(changes.find((change) => change.kind === "removed")?.before.truncated).toBe(true);
  expect(changes.find((change) => change.kind === "type")?.before.truncated).toBe(true);
  expect(changes.find((change) => change.kind === "type")?.after).toEqual({
    text: "1",
    truncated: false,
  });
});
