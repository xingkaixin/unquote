import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { UnquoteApp } from "../src/app";
import { I18nProvider } from "../src/i18n/context";

Object.assign(globalThis, {
  Worker: class {
    constructor(..._args: unknown[]) {}
    onmessage: ((event: MessageEvent) => void) | null = null;
    addEventListener(_type: string, listener: (event: MessageEvent) => void) {
      this.onmessage = listener;
    }
    removeEventListener() {}
    postMessage(payload: { input: string; forcedFormat?: "json" | "jsonl" }) {
      import("@unquote/core").then(({ parseInput }) => {
        this.onmessage?.({
          data: parseInput(
            payload.input,
            payload.forcedFormat ? { forcedFormat: payload.forcedFormat } : {},
          ),
        } as MessageEvent);
      });
    }
  },
});

describe("UnquoteApp", () => {
  it("renders and parses input", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <UnquoteApp initialInput='{"payload":"{\\"ok\\":true}"}' />
      </I18nProvider>,
    );
    await user.click(screen.getByRole("tab", { name: "Output" }));
    await waitFor(() => expect(screen.getAllByText("#1").length).toBeGreaterThan(0));
    expect(screen.getAllByText("Expand All")[0]).toBeInTheDocument();
    expect(screen.getAllByText("Copy All")[0]).toBeInTheDocument();
  });
});
