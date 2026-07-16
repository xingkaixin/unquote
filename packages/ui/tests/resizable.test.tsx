import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../src/components/resizable";

afterEach(cleanup);

const renderPanels = (withHandle?: boolean) =>
  render(
    <ResizablePanelGroup id="panel-group" className="custom-group" orientation="horizontal">
      <ResizablePanel defaultSize="50%">First</ResizablePanel>
      <ResizableHandle {...(withHandle === undefined ? {} : { withHandle })} />
      <ResizablePanel defaultSize="50%">Second</ResizablePanel>
    </ResizablePanelGroup>,
  );

describe("resizable components", () => {
  it("renders a panel group with the default visible handle", () => {
    renderPanels();

    expect(screen.getByTestId("panel-group")).toHaveClass("flex", "custom-group");
    const separator = screen.getByRole("separator");
    expect(separator).toHaveAttribute("aria-orientation", "vertical");
    expect(separator.querySelector("svg")).toBeInTheDocument();
  });

  it("can hide the visual handle", () => {
    renderPanels(false);

    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
    expect(screen.getByRole("separator").querySelector("svg")).not.toBeInTheDocument();
  });
});
