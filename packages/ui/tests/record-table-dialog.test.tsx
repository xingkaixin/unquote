import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { parseInput } from "@unquote/core";
import { RecordTableDialog } from "../src/components/record-table-dialog";
import { I18nProvider } from "../src/i18n/context";
import { createTextSourceRevision } from "../src/lib/published-source";

afterEach(cleanup);
it("filters selected columns and returns a matching row to its canonical record", async () => {
  const user = userEvent.setup();
  const text = '{"price":10}\n{"price":20}';
  const records = parseInput(text, { forcedFormat: "jsonl" }).records;
  const onOpenRecord = vi.fn();
  const onClose = vi.fn();
  render(
    <I18nProvider>
      <RecordTableDialog
        source={createTextSourceRevision(1, text, "jsonl")}
        records={records}
        selectedPath="$.price"
        onOpenRecord={onOpenRecord}
        onClose={onClose}
      />
    </I18nProvider>,
  );
  await screen.findByRole("dialog");
  await user.selectOptions(screen.getByRole("combobox", { name: "Condition" }), "greater");
  fireEvent.change(screen.getByRole("textbox", { name: "Value" }), { target: { value: "15" } });
  await user.click(screen.getByRole("button", { name: "Apply and scan" }));
  expect(
    await screen.findByText("1 matches · 2 scanned · 0 invalid lines skipped"),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "2" }));
  expect(onOpenRecord).toHaveBeenCalledWith(records[1]!.id);
  expect(onClose).toHaveBeenCalledOnce();
});

it("replaces conditions when drilling into a profile count", async () => {
  const user = userEvent.setup();
  const text = '{"price":10}\n{"price":null}\n{}';
  const records = parseInput(text, { forcedFormat: "jsonl" }).records;
  render(
    <I18nProvider>
      <RecordTableDialog
        source={createTextSourceRevision(1, text, "jsonl")}
        records={records}
        selectedPath="$.price"
        onOpenRecord={vi.fn()}
        onClose={vi.fn()}
      />
    </I18nProvider>,
  );
  await screen.findByRole("dialog");
  await user.click(screen.getByRole("button", { name: "Apply and scan" }));
  await user.click(await screen.findByRole("button", { name: "$.price: Missing (1)" }));
  expect(
    await screen.findByText("1 matches · 3 scanned · 0 invalid lines skipped"),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "3" })).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "Condition" })).toHaveValue("missing");
});
