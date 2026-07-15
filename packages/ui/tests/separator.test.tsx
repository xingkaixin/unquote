import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Separator } from "../src/components/separator";

afterEach(cleanup);

describe("Separator", () => {
  it("renders a horizontal separator by default", () => {
    render(<Separator className="custom-separator" />);

    expect(screen.getByRole("separator")).toHaveClass("h-px", "w-full", "custom-separator");
  });

  it("renders the vertical orientation", () => {
    render(<Separator orientation="vertical" />);

    expect(screen.getByRole("separator")).toHaveAttribute("aria-orientation", "vertical");
    expect(screen.getByRole("separator")).toHaveClass("h-full", "w-px");
  });
});
