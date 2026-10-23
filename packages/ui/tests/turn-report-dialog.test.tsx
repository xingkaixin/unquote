import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { AgentSessionView } from "../src/components/agent-session-view";
import { I18nProvider } from "../src/i18n/context";
import { createAgentSessionModel } from "../src/lib/agent-session";
import { createJsonlIngestion } from "../src/lib/jsonl-ingestion";
import { createLocalFileAccess } from "../src/lib/local-file-source";
import {
  createStreamingFileSourceRevision,
  createTextSourceRevision,
} from "../src/lib/published-source";
import { createStreamFile } from "./helpers/stub-file";

afterEach(cleanup);

const lines = [
  '{"type":"user","uuid":"u1","promptId":"p1","message":{"content":"First prompt"}}',
  '{"type":"assistant","uuid":"u2","message":{"stop_reason":"end_turn","content":[{"type":"text","text":"First reply"}]}}',
  '{"type":"user","uuid":"u3","promptId":"p2","message":{"content":"Second prompt"}}',
  '{"type":"assistant","uuid":"u4","message":{"content":[{"type":"text","text":"Second reply"}]}}',
];

const text = lines.join("\n");

const ingestion = createJsonlIngestion("session.jsonl");

const records = lines.map((line, index) => ingestion.ingestFullLine(line, index + 1));

const session = ingestion.finishAgentSession()!;

const model = createAgentSessionModel(session);

const view = (reportSource: ComponentProps<typeof AgentSessionView>["reportSource"]) => (
  <I18nProvider>
    <AgentSessionView
      session={session}
      model={model}
      isDesktop
      detailSelection={null}
      reportSource={reportSource}
      onDetailSelectionChange={vi.fn()}
      onOpenRecord={vi.fn()}
    />
  </I18nProvider>
);

it("exports the turns selected in the conversation pane once the Records are ready", async () => {
  const user = userEvent.setup();
  const { rerender } = render(view(undefined));

  await user.click(screen.getByRole("checkbox", { name: "Select turn 2 for the report" }));
  await user.click(screen.getByRole("checkbox", { name: "Select turn 1 for the report" }));
  expect(screen.getByText("2 turns selected")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Export turns" })).toBeDisabled();

  rerender(view({ source: createTextSourceRevision(1, text, "jsonl"), records }));
  await user.click(screen.getByRole("button", { name: "Export turns" }));
  expect(await screen.findByText("Selected turns: 1, 2")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Build preview" }));
  expect(await screen.findByText("4 records · 0 values redacted")).toBeInTheDocument();
  expect(screen.getByText(/## Turn 2/)).toHaveTextContent("Second reply");

  await user.keyboard("{Escape}");
  await user.click(await screen.findByRole("button", { name: "Clear" }));
  expect(screen.queryByText("2 turns selected")).not.toBeInTheDocument();
});

it("cancels a report built for an obsolete Source Revision", async () => {
  const user = userEvent.setup();
  const access = createLocalFileAccess(createStreamFile(text, "session.jsonl").file);
  let streamSignal: AbortSignal | undefined;
  vi.spyOn(access, "streamRecords").mockImplementation(
    (_lines, _consume, signal) =>
      new Promise((_, reject) => {
        streamSignal = signal;
        signal?.addEventListener("abort", () => reject(signal.reason));
      }),
  );
  try {
    const { rerender } = render(
      view({ source: createStreamingFileSourceRevision(1, access, "jsonl"), records }),
    );
    await user.click(screen.getByRole("checkbox", { name: "Select turn 1 for the report" }));
    await user.click(screen.getByRole("button", { name: "Export turns" }));
    await user.click(await screen.findByRole("button", { name: "Build preview" }));
    expect(screen.getByRole("button", { name: "Building…" })).toBeDisabled();
    expect(streamSignal?.aborted).toBe(false);

    rerender(view({ source: createStreamingFileSourceRevision(2, access, "jsonl"), records }));

    expect(streamSignal?.aborted).toBe(true);
    expect(await screen.findByRole("button", { name: "Build preview" })).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  } finally {
    access.dispose();
  }
});
