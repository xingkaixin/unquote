import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const html = readFileSync(fileURLToPath(new URL("../index.html", import.meta.url)), "utf8");

describe("web localization metadata", () => {
  it("advertises every supported product locale", () => {
    expect(html).toContain('<meta property="og:locale:alternate" content="zh_CN" />');
    expect(html).toContain('<meta property="og:locale:alternate" content="ja_JP" />');
    expect(html).toContain('"inLanguage": ["en", "zh-CN", "ja"]');
  });
});
