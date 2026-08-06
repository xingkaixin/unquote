import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "../src/components/button";

afterEach(cleanup);

describe("Button base style", () => {
  it("keeps the sentence-case sans typography the redesign specifies", () => {
    render(<Button>Copy value</Button>);
    const button = screen.getByRole("button", { name: "Copy value" });

    expect(button).not.toHaveClass("font-mono");
    expect(button).not.toHaveClass("uppercase");
    expect(button.className).not.toMatch(/tracking-/);
  });

  it("carries the shared control radius so call sites do not each restore one", () => {
    render(<Button>Export</Button>);

    expect(screen.getByRole("button", { name: "Export" })).toHaveClass("rounded-md");
  });

  it("leaves mono to the call sites that ask for it", () => {
    render(
      <>
        <Button>Copy value</Button>
        <Button className="font-mono">JSONL</Button>
      </>,
    );

    expect(screen.getByRole("button", { name: "Copy value" })).not.toHaveClass("font-mono");
    expect(screen.getByRole("button", { name: "JSONL" })).toHaveClass("font-mono");
  });

  it.each([
    // dc:58-59 gives the header's chrome controls a --line2 border that turns
    // accent on hover; ghost is the only variant allowed to drop the border.
    { variant: undefined, expected: ["border-border-medium", "hover:border-accent"] },
    { variant: "outline" as const, expected: ["border-border", "hover:border-border-medium"] },
    { variant: "ghost" as const, expected: ["border-transparent"] },
    { variant: "secondary" as const, expected: ["border-accent", "bg-accent", "text-white"] },
    { variant: "selected" as const, expected: ["border-accent", "bg-accent-soft"] },
  ])("keeps the $variant variant visually distinct", ({ variant, expected }) => {
    render(<Button variant={variant}>Filter</Button>);

    expect(screen.getByRole("button", { name: "Filter" })).toHaveClass(...expected);
  });
});
