import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { formatResult, parseInput } from "../../../packages/core/src/index";
import { renderHomepage } from "../src/homepage";
import { CHROME_WEB_STORE_URL, EDGE_ADDONS_URL, guideSlugs } from "../src/site-links";
import { welcomeCopy } from "../src/welcome-copy";

const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");

describe("homepage static content", () => {
  it("explains the tool, FAQs, extensions, and working example without JavaScript", () => {
    const document = new JSDOM(renderHomepage()).window.document;
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(document.querySelector("h1")?.textContent).toContain("JSON / JSONL / SSE viewer");
    expect(document.querySelectorAll("dt")).toHaveLength(4 + welcomeCopy.en.faqs.length);
    expect(document.body.textContent).toContain("without uploading");
    expect(document.body.textContent).toContain("Enable JavaScript");
    const code = [...document.querySelectorAll("pre code")].map((node) => node.textContent ?? "");
    expect(code).toHaveLength(2);
    expect(JSON.parse(formatResult(parseInput(code[0]!)))).toEqual(JSON.parse(code[1]!));
    expect(document.querySelector("button")).toBeNull();
    expect(document.querySelector(`a[href="${CHROME_WEB_STORE_URL}"]`)).not.toBeNull();
    expect(document.querySelector(`a[href="${EDGE_ADDONS_URL}"]`)).not.toBeNull();
    for (const slug of guideSlugs) {
      expect(document.querySelector(`a[href="/${slug}/"]`)).not.toBeNull();
    }

    const headDoc = new JSDOM(indexHtml).window.document;
    const schemaText = headDoc.querySelector('script[type="application/ld+json"]')?.textContent;
    // SAFETY: index.html embeds a JSON-LD @graph checked below.
    const schema = JSON.parse(schemaText ?? "") as {
      "@graph": Array<{
        "@type": string;
        mainEntity?: Array<{ name: string; acceptedAnswer: { text: string } }>;
      }>;
    };
    const faqNode = schema["@graph"].find((entry) => entry["@type"] === "FAQPage");
    expect(faqNode?.mainEntity?.map((item) => item.name)).toEqual(
      welcomeCopy.en.faqs.map((item) => item.question),
    );
  });
});
