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

  it("lets a call site opt into mono without fighting the base", () => {
    render(<Button className="font-mono">JSONL</Button>);

    expect(screen.getByRole("button", { name: "JSONL" })).toHaveClass("font-mono");
  });

  it.each([
    { variant: undefined, expected: "border-border-medium" },
    { variant: "outline" as const, expected: "border-border" },
    { variant: "ghost" as const, expected: "border-transparent" },
    { variant: "secondary" as const, expected: "bg-accent" },
    { variant: "selected" as const, expected: "bg-accent-soft" },
  ])("keeps the $variant variant visually distinct", ({ variant, expected }) => {
    render(<Button variant={variant}>Filter</Button>);

    expect(screen.getByRole("button", { name: "Filter" })).toHaveClass(expected);
  });
});
