import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { renderChangelogPage } from "../src/changelog-page";
import { changelogLocales, changelogPaths } from "../src/changelog-routes";

const SITE_ORIGIN = "https://unquote.xingkaixin.me";

const expectedHeadings = {
  en: "What is changing in Unquote",
  "zh-CN": "Unquote 正在发生什么变化",
  ja: "Unquote はどう変わっているか",
} as const;

const documents = Object.fromEntries(
  changelogLocales.map((locale) => [
    locale,
    new JSDOM(renderChangelogPage(locale)).window.document,
  ]),
);

describe("product updates page", () => {
  it.each(changelogLocales)("ships %s release content in the initial HTML", (locale) => {
    const document = documents[locale];

    expect(document.documentElement.lang).toBe(locale);
    expect(document.querySelector("h1")?.textContent).toBe(expectedHeadings[locale]);
    expect(document.querySelectorAll("article.release")).toHaveLength(5);
    expect(document.body.textContent).not.toContain("@unquote/core");
  });

  it.each(changelogLocales)("publishes localized metadata and schema for %s", (locale) => {
    const document = documents[locale];
    const canonicalUrl = `${SITE_ORIGIN}${changelogPaths[locale]}`;

    expect(document.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      canonicalUrl,
    );
    expect(document.querySelectorAll('link[rel="alternate"]')).toHaveLength(4);
    expect(document.querySelector('meta[property="og:locale"]')?.getAttribute("content")).toBe(
      { en: "en_US", "zh-CN": "zh_CN", ja: "ja_JP" }[locale],
    );

    const schemaText = document.querySelector('script[type="application/ld+json"]')?.textContent;
    const schema = JSON.parse(schemaText ?? "") as {
      "@graph": Array<{
        "@type": string;
        inLanguage?: string;
        blogPost?: Array<{ inLanguage: string; url: string }>;
      }>;
    };
    const blog = schema["@graph"].find((entry) => entry["@type"] === "Blog");

    expect(blog?.inLanguage).toBe(locale);
    expect(blog?.blogPost).toHaveLength(5);
    expect(blog?.blogPost?.[0]?.inLanguage).toBe(locale);
    expect(blog?.blogPost?.[0]?.url).toBe(`${canonicalUrl}#v1-2-1`);
  });

  it("uses a unique page title for each locale", () => {
    expect(new Set(changelogLocales.map((locale) => documents[locale].title))).toHaveLength(3);
  });

  it("links every localized page from the sitemap", () => {
    const sitemap = readFileSync(
      fileURLToPath(new URL("../public/sitemap.xml", import.meta.url)),
      "utf8",
    );

    for (const path of Object.values(changelogPaths)) {
      expect(sitemap).toContain(`${SITE_ORIGIN}${path}`);
    }
  });
});
