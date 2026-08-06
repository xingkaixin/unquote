import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImportDialog } from "../src/components/import-dialog";
import { I18nProvider } from "../src/i18n/context";

afterEach(cleanup);

const renderDialog = (overrides: Partial<ComponentProps<typeof ImportDialog>> = {}) => {
  const props: ComponentProps<typeof ImportDialog> = {
    open: true,
    dismissible: true,
    onClose: vi.fn(),
    children: <p>import panel</p>,
    ...overrides,
  };
  render(
    <I18nProvider>
      <ImportDialog {...props} />
    </I18nProvider>,
  );
  return { props };
};

describe("ImportDialog", () => {
  it("stays out of the tree while closed", () => {
    renderDialog({ open: false });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("import panel")).not.toBeInTheDocument();
  });

  it("frames the import panel with its title and subtitle", async () => {
    renderDialog();
    const dialog = await screen.findByRole("dialog", { name: "Import data" });

    expect(dialog).toHaveAccessibleDescription("Paste text, choose a file, or drop one in");
    expect(screen.getByText("import panel")).toBeInTheDocument();
  });

  it("offers Back only when there is a workspace to go back to", async () => {
    const user = userEvent.setup();
    const { props } = renderDialog();
    await screen.findByRole("dialog");

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(props.onClose).toHaveBeenCalledOnce();

    cleanup();
    renderDialog({ dismissible: false });
    await screen.findByRole("dialog");
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  });

  it("closes on Escape even without a Back button", async () => {
    const user = userEvent.setup();
    const { props } = renderDialog({ dismissible: false });
    await screen.findByRole("dialog");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(props.onClose).toHaveBeenCalledOnce());
  });
});
