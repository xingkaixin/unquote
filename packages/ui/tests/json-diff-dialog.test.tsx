import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { JsonDiffDialog } from "../src/components/json-diff-dialog";
import { I18nProvider } from "../src/i18n/context";
import { createTextSourceRevision } from "../src/lib/published-source";

afterEach(cleanup);
it("compares pasted JSON and clears stale results when inputs change", async () => {
  const user = userEvent.setup();
  render(
    <StrictMode>
      <I18nProvider>
        <JsonDiffDialog
          source={createTextSourceRevision(1, "", "auto")}
          records={[]}
          activeRecord={null}
          onClose={vi.fn()}
        />
      </I18nProvider>
    </StrictMode>,
  );
  await screen.findByRole("dialog");
  fireEvent.change(screen.getByRole("textbox", { name: "Before" }), {
    target: { value: '{"n":1}' },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "After" }), {
    target: { value: '{"n":2}' },
  });
  await user.click(screen.getByRole("button", { name: "Compare" }));
  expect(await screen.findByText("1 differences")).toBeInTheDocument();
  expect(screen.getByText("$.n")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "Before" }), {
    target: { value: '{"n":2}' },
  });
  expect(screen.queryByText("1 differences")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Compare" }));
  expect(
    await screen.findByText("No differences under these comparison rules."),
  ).toBeInTheDocument();
});
