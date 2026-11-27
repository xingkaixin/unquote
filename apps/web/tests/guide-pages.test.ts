import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { formatResult, parseInput } from "../../../packages/core/src/index";
import { guides } from "../src/guide-content";
import { renderGuidePage } from "../src/guide-page";
import { renderHomepage } from "../src/homepage";
import {
  CHROME_WEB_STORE_URL,
  EDGE_ADDONS_URL,
  SITE_ORIGIN,
  guideLocales,
  guidePath,
  guideSlugs,
} from "../src/site-links";

const sitemap = readFileSync(new URL("../public/sitemap.xml", import.meta.url), "utf8");

const pageMatrix = guideSlugs.flatMap((slug) =>
  guideLocales.map((locale) => [slug, locale] as const),
);

describe("search landing pages", () => {
  it.each(pageMatrix)(
    "renders discoverable %s (%s) HTML with FAQ schema, hreflang, and interactive entry",
    (slug, locale) => {
      const document = new JSDOM(renderGuidePage(slug, locale)).window.document;
      const homepage = new JSDOM(renderHomepage()).window.document;
      const url = `${SITE_ORIGIN}${guidePath(slug, locale)}`;

      expect(document.documentElement.lang).toBe(locale);
      expect(document.querySelectorAll("h1")).toHaveLength(1);
      expect(document.querySelectorAll("article section").length).toBeGreaterThanOrEqual(5);
      expect(document.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(url);
      expect(document.querySelector('meta[property="og:url"]')?.getAttribute("content")).toBe(url);
      expect(document.querySelectorAll('link[rel="alternate"]')).toHaveLength(3);
      expect(
        document.querySelector('link[rel="alternate"][hreflang="x-default"]')?.getAttribute("href"),
      ).toBe(`${SITE_ORIGIN}${guidePath(slug, "en")}`);
      expect(document.querySelector('script[type="module"]')?.getAttribute("src")).toBe(
        "/src/guide-main.tsx",
      );
      expect(document.querySelector("[data-guide-header]")).not.toBeNull();
      expect(document.querySelector("[data-guide-body]")).not.toBeNull();
      expect(document.querySelector('a[href="/"][data-umami-event="open-viewer"]')).not.toBeNull();
      expect(document.querySelector(`a[href="${CHROME_WEB_STORE_URL}"]`)).not.toBeNull();
      expect(document.querySelector(`a[href="${EDGE_ADDONS_URL}"]`)).not.toBeNull();
      if (locale === "en") {
        expect(homepage.querySelector(`a[href="${guidePath(slug, "en")}"]`)).not.toBeNull();
      }
      expect(sitemap).toContain(`<loc>${url}</loc>`);

      const schemaText = document.querySelector('script[type="application/ld+json"]')?.textContent;
      // SAFETY: renderGuidePage emits a JSON-LD @graph fixture validated below.
      const schema = JSON.parse(schemaText ?? "") as {
        "@graph": Array<{
          "@type": string;
          mainEntity?: Array<{ name: string; acceptedAnswer: { text: string } }>;
        }>;
      };
      const faqNode = schema["@graph"].find((entry) => entry["@type"] === "FAQPage");
      expect(faqNode?.mainEntity).toHaveLength(guides[slug][locale].faqs.length);
      for (const item of guides[slug][locale].faqs) {
        expect(document.body.textContent).toContain(item.question);
        expect(document.body.textContent).toContain(item.answer);
      }

      for (const related of guideSlugs.filter((value) => value !== slug)) {
        expect(document.querySelector(`a[href="${guidePath(related, locale)}"]`)).not.toBeNull();
      }
    },
  );

  it("shows an escaped JSON example that produces the documented output", () => {
    const document = new JSDOM(renderGuidePage("json-unescape", "en")).window.document;
    const examples = [...document.querySelectorAll("pre code")].map((node) => node.textContent!);
    expect(JSON.parse(formatResult(parseInput(examples[0]!)))).toEqual(JSON.parse(examples[1]!));
  });

  it("shows an SSE example that parses as an SSE stream with expanded JSON", () => {
    const document = new JSDOM(renderGuidePage("sse-viewer", "en")).window.document;
    const example = document.querySelector("pre code")?.textContent ?? "";
    const parsed = parseInput(example, { mode: "sse" });
    expect(parsed.format).toBe("sse");
    expect(parsed.records).toHaveLength(2);
    expect(parsed.stats.failed).toBe(0);
  });
});
