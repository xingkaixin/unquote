import { cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ScrollArea } from "../src/components/scroll-area";

afterEach(cleanup);

describe("ScrollArea", () => {
  it("renders content and forwards root props and refs", () => {
    const ref = createRef<HTMLDivElement>();

    render(
      <ScrollArea ref={ref} className="custom-scroll" data-testid="scroll-area">
        <span>Scrollable content</span>
      </ScrollArea>,
    );

    expect(screen.getByText("Scrollable content")).toBeInTheDocument();
    expect(screen.getByTestId("scroll-area")).toHaveClass("relative", "custom-scroll");
    expect(ref.current).toBe(screen.getByTestId("scroll-area"));
  });
});
