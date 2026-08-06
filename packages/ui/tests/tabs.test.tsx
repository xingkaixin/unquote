import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Tabs, TabsList, TabsTrigger } from "../src/components/tabs";

afterEach(cleanup);

describe("TabsTrigger", () => {
  it("paints the active tab with the solid accent fill", () => {
    render(
      <Tabs value="json">
        <TabsList>
          <TabsTrigger value="agent">AGENT</TabsTrigger>
          <TabsTrigger value="json">JSONL</TabsTrigger>
        </TabsList>
      </Tabs>,
    );

    const active = screen.getByRole("tab", { name: "JSONL" });
    const inactive = screen.getByRole("tab", { name: "AGENT" });

    expect(active).toHaveClass("data-active:bg-accent", "data-active:text-white");
    expect(active).toHaveAttribute("data-active");
    expect(inactive).not.toHaveAttribute("data-active");
    expect(inactive).toHaveClass("text-text-secondary");
  });
});
