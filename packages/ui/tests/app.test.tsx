import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { UnquoteApp } from "../src/app";

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
    render(<UnquoteApp initialInput='{"payload":"{\\"ok\\":true}"}' />);
    await user.click(screen.getByRole("tab", { name: "输出" }));
    await waitFor(() => expect(screen.getAllByText("#1").length).toBeGreaterThan(0));
    expect(screen.getAllByText("展开全部")[0]).toBeInTheDocument();
    expect(screen.getAllByText("复制全部")[0]).toBeInTheDocument();
  });
});
