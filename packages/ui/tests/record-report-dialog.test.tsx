import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { parseInput } from "@unquote/core";
import { RecordReportDialog } from "../src/components/record-report-dialog";
import { I18nProvider } from "../src/i18n/context";
import { createTextSourceRevision } from "../src/lib/published-source";

afterEach(cleanup);
it("requires a current preview before export and invalidates it when redactions change", async () => {
  const user = userEvent.setup();
  const text = '{"token":"secret"}';
  render(
    <I18nProvider>
      <RecordReportDialog
        source={createTextSourceRevision(1, text, "json")}
        records={parseInput(text).records}
        activeLine={1}
        onClose={vi.fn()}
      />
    </I18nProvider>,
  );
  await screen.findByRole("dialog");
  expect(screen.getByRole("button", { name: "Download JSONL" })).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox", { name: "Redact paths, one per line" }), {
    target: { value: "$.token" },
  });
  await user.click(screen.getByRole("button", { name: "Build preview" }));
  expect(await screen.findByText("1 records · 1 values redacted")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Download JSONL" })).toBeEnabled();
  expect(screen.getByText(/# Unquote report/)).not.toHaveTextContent("secret");
  fireEvent.change(screen.getByRole("textbox", { name: "Redact paths, one per line" }), {
    target: { value: "$.other" },
  });
  expect(screen.getByRole("button", { name: "Download JSONL" })).toBeDisabled();
});
