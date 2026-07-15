import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../src/components/tooltip";

afterEach(cleanup);

const renderTooltip = (sideOffset?: number) =>
  render(
    <TooltipProvider>
      <Tooltip defaultOpen>
        <TooltipTrigger>Trigger</TooltipTrigger>
        <TooltipContent
          className="custom-tooltip"
          {...(sideOffset === undefined ? {} : { sideOffset })}
        >
          Helpful text
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>,
  );

describe("TooltipContent", () => {
  it("renders open tooltip content with the default offset", async () => {
    renderTooltip();

    expect(await screen.findByText("Helpful text")).toHaveClass("custom-tooltip");
  });

  it("accepts a custom side offset", async () => {
    renderTooltip(12);

    const content = await screen.findByText("Helpful text");
    expect(content.parentElement).toHaveStyle({ transform: "translate(0px, -12px)" });
  });
});
