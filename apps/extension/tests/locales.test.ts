import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface ExtensionMessage {
  message: string;
}

const readMessages = (locale: string) =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../public/_locales/${locale}/messages.json`, import.meta.url)),
      "utf8",
    ),
  ) as Record<string, ExtensionMessage>;

describe("extension locale catalogs", () => {
  it("keeps the Japanese manifest messages complete", () => {
    const english = readMessages("en");
    const japanese = readMessages("ja");

    expect(Object.keys(japanese).sort()).toEqual(Object.keys(english).sort());
    expect(Object.values(japanese).every(({ message }) => message.length > 0)).toBe(true);
    expect(japanese.openInUnquote?.message).toBe("Unquote で開く");
  });
});
