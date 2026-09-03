import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "../src/components/theme-toggle";
import { I18nProvider } from "../src/i18n/context";

afterEach(cleanup);

const themes = ["system", "light", "dark"] as const;

describe("ThemeToggle", () => {
  it.each(themes)("renders the %s theme icon", (theme) => {
    render(
      <I18nProvider>
        <ThemeToggle theme={theme} onChange={vi.fn()} />
      </I18nProvider>,
    );

    expect(screen.getByRole("button", { name: "Switch theme" }).querySelector("svg")).toHaveClass(
      "size-4",
    );
  });

  it("forwards the selected menu theme", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <I18nProvider>
        <ThemeToggle theme="system" onChange={onChange} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Switch theme" }));
    expect(await screen.findByRole("menu")).toHaveClass("uq-dropdown-popup");
    await user.click(await screen.findByRole("menuitemradio", { name: "Dark" }));

    expect(onChange).toHaveBeenCalledWith("dark");
  });
});
