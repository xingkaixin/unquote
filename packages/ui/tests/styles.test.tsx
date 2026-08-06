import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// jsdom replaces the URL global, so resolve the path rather than passing a URL to fs.
const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../src/styles.css"),
  "utf8",
);

describe("styles.css cascade", () => {
  it("leaves the control font reset to preflight", () => {
    // Preflight already resets button/input/select/textarea inside @layer base.
    // Repeating it unlayered outranks every Tailwind utility, which silently
    // voided the 11px tab (dc:41), the 10px ⌘K badge and the 12px search input.
    expect(css).not.toMatch(/font:\s*inherit/);
  });

  it("layers the shared 11px control size so call sites can override it", () => {
    expect(css).toMatch(/@layer components \{\s*\.uq-text-11 \{/);
  });
});
