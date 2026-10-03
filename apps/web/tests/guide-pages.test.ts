import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { formatResult, parseInput } from "../../../packages/core/src/index";
import { guides } from "../src/guide-content";
import { renderGuidePage } from "../src/guide-page";
import { renderHomepage } from "../src/homepage";

const slugs = Object.keys(guides);

const sitemap = readFileSync(new URL("../public/sitemap.xml", import.meta.url), "utf8");

describe("search landing pages", () => {
  it.each(slugs)("makes %s discoverable and useful without client rendering", (slug) => {
    const document = new JSDOM(renderGuidePage(slug)).window.document;
    const homepage = new JSDOM(renderHomepage()).window.document;
    const url = `https://unquote.xingkaixin.me/${slug}/`;

    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(document.querySelectorAll("article section").length).toBeGreaterThanOrEqual(4);
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(url);
    expect(document.querySelector('meta[property="og:url"]')?.getAttribute("content")).toBe(url);
    expect(document.querySelector('script[type="module"]')).toBeNull();
    expect(document.querySelector('a[href="/"][data-umami-event="open-viewer"]')).not.toBeNull();
    expect(homepage.querySelector(`a[href="/${slug}/"]`)).not.toBeNull();
    expect(sitemap).toContain(`<loc>${url}</loc>`);
    expect(() =>
      JSON.parse(document.querySelector('script[type="application/ld+json"]')!.textContent!),
    ).not.toThrow();

    for (const related of slugs.filter((value) => value !== slug)) {
      expect(document.querySelector(`a[href="/${related}/"]`)).not.toBeNull();
    }
  });

  it("shows an escaped JSON example that produces the documented output", () => {
    const document = new JSDOM(renderGuidePage("json-unescape")).window.document;
    const examples = [...document.querySelectorAll("pre code")].map((node) => node.textContent!);
    expect(JSON.parse(formatResult(parseInput(examples[0]!)))).toEqual(JSON.parse(examples[1]!));
  });
});
