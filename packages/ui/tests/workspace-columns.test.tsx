import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceColumns } from "../src/components/workspace-columns";

afterEach(cleanup);

const renderColumns = (overrides: Partial<ComponentProps<typeof WorkspaceColumns>> = {}) => {
  const props: ComponentProps<typeof WorkspaceColumns> = {
    isDesktop: true,
    leftWidth: 340,
    rightWidth: 310,
    leftMobileHeight: "30vh",
    rightLabel: "Selected node",
    left: <p>rail</p>,
    center: <p>tree</p>,
    right: <p>inspector</p>,
    ...overrides,
  };
  return render(<WorkspaceColumns {...props} />);
};

const paneOf = (text: string) => screen.getByText(text).parentElement!;

describe("WorkspaceColumns", () => {
  it("gives the desktop side columns their fixed widths", () => {
    renderColumns();

    expect(paneOf("rail")).toHaveStyle({ width: "340px" });
    expect(paneOf("inspector")).toHaveStyle({ width: "310px" });
    expect(paneOf("tree")).toHaveClass("flex-1", "min-w-0");
    expect(screen.queryByText("Selected node")).not.toBeInTheDocument();
  });

  it("stacks the columns and hides the right pane behind a disclosure on mobile", () => {
    const { container } = renderColumns({ isDesktop: false });

    expect(paneOf("rail").style.height).toBe("30vh");
    const disclosure = container.querySelector("details")!;
    expect(disclosure).toContainElement(screen.getByText("inspector"));
    expect(disclosure.querySelector("summary")).toHaveTextContent("Selected node");
  });

  it.each([true, false])("leaves scrolling to the panes when isDesktop is %s", (isDesktop) => {
    const { container } = renderColumns({ isDesktop });

    // A column that scrolls would steal the scroll root its pane's virtualizer
    // needs; only the mobile disclosure is allowed to.
    for (const column of container.querySelectorAll("div > div")) {
      expect(column.className).not.toMatch(/overflow/);
    }
  });
});
