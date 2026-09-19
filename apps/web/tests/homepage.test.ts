import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { formatResult, parseInput } from "../../../packages/core/src/index";
import { renderHomepage } from "../src/homepage";

describe("homepage static content", () => {
  it("explains the tool and shows a working example without JavaScript", () => {
    const document = new JSDOM(renderHomepage()).window.document;
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(document.querySelector("h1")?.textContent).toContain("JSON / JSONL viewer");
    expect(document.querySelectorAll("dt")).toHaveLength(3);
    expect(document.body.textContent).toContain("without uploading their contents");
    expect(document.body.textContent).toContain("Enable JavaScript");
    const code = [...document.querySelectorAll("pre code")].map((node) => node.textContent ?? "");
    expect(code).toHaveLength(2);
    expect(JSON.parse(formatResult(parseInput(code[0]!)))).toEqual(JSON.parse(code[1]!));
    expect(document.querySelector("button")).toBeNull();
  });
});
